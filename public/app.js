        let currentQuizData = [];
        let timerInterval;
        let timeRemaining = 0;
        let authMode = 'login';
        let currentQuizConfig = null;
        let currentWrongAnswers = [];
        let currentReviewAnswers = [];
        const USERS_STORAGE_KEY = 'quizUsers';
        const LEGACY_USER_STORAGE_KEY = 'quizUser';
        const SESSION_STORAGE_KEY = 'quizSession';

        function setAuthMode(mode) {
            authMode = mode;
            const isSignup = mode === 'signup';

            document.getElementById('name-field').style.display = isSignup ? 'grid' : 'none';
            document.getElementById('auth-submit').textContent = isSignup ? 'Create Account' : 'Login';
            document.getElementById('auth-helper').textContent = isSignup
                ? 'Create a simple local account for this browser, then jump straight into the quiz.'
                : 'Use your email and password to continue to the quiz dashboard.';
            document.getElementById('login-tab').classList.toggle('active', !isSignup);
            document.getElementById('signup-tab').classList.toggle('active', isSignup);
            setAuthMessage('');
        }

        function setAuthMessage(message, type = '') {
            const authMessage = document.getElementById('auth-message');
            authMessage.textContent = message;
            authMessage.className = type ? `auth-message ${type}` : 'auth-message';
        }

        function getQuizSource() {
            return document.getElementById('quiz-source').value;
        }

        function updateQuizSourceUI() {
            const source = getQuizSource();
            const customTopicField = document.getElementById('custom-topic-field');
            const categoryField = document.getElementById('category');
            const difficultyField = document.getElementById('difficulty');

            customTopicField.style.display = source === 'gemini' ? 'grid' : 'none';
            categoryField.disabled = false;
            difficultyField.disabled = false;
        }

        const TOKEN_STORAGE_KEY = 'quiz_auth_token';
        const USER_STORAGE_KEY = 'quiz_auth_user';

        function setSession(token, user) {
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
            updateAuthUI();
        }

        function getSession() {
            const token = localStorage.getItem(TOKEN_STORAGE_KEY);
            const userStr = localStorage.getItem(USER_STORAGE_KEY);
            if (!token || !userStr) return null;
            try {
                return JSON.parse(userStr);
            } catch (e) {
                return null;
            }
        }

        function getAuthToken() {
            return localStorage.getItem(TOKEN_STORAGE_KEY);
        }

        function logout() {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            localStorage.removeItem(USER_STORAGE_KEY);
            closeQuizPage({ reset: true });
            updateAuthUI();
            setAuthMessage('You have been logged out.', 'success');
        }

        async function getQuizHistory() {
            const token = getAuthToken();
            if (!token) return [];
            
            try {
                const response = await fetch('/api/history', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) return [];
                return await response.json();
            } catch (e) {
                console.error('Failed to fetch history', e);
                return [];
            }
        }

        async function deleteHistoryEntry(id) {
            const token = getAuthToken();
            if (!token) return;

            if (!confirm('Are you sure you want to delete this quiz attempt?')) {
                return;
            }

            try {
                const response = await fetch(`/api/history/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    await renderHistoryDashboard();
                } else {
                    alert('Failed to delete history entry.');
                }
            } catch (e) {
                console.error('Failed to delete entry', e);
                alert('Failed to delete history entry.');
            }
        }

        function switchDashboardTab(tab) {
            document.getElementById('tab-history').classList.remove('active');
            document.getElementById('tab-leaderboard').classList.remove('active');
            document.getElementById('tab-saved').classList.remove('active');
            
            document.getElementById('history-view').style.display = 'none';
            document.getElementById('leaderboard-view').style.display = 'none';
            document.getElementById('saved-view').style.display = 'none';

            if (tab === 'history') {
                document.getElementById('tab-history').classList.add('active');
                document.getElementById('history-view').style.display = 'block';
            } else if (tab === 'leaderboard') {
                document.getElementById('tab-leaderboard').classList.add('active');
                document.getElementById('leaderboard-view').style.display = 'block';
                renderLeaderboard();
            } else if (tab === 'saved') {
                document.getElementById('tab-saved').classList.add('active');
                document.getElementById('saved-view').style.display = 'block';
                renderSavedQuestions();
            }
        }

        async function fetchSavedQuestions() {
            try {
                const token = getAuthToken();
                const response = await fetch('/api/saved-questions', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) return [];
                return await response.json();
            } catch (e) {
                console.error('Failed to fetch saved questions', e);
                return [];
            }
        }

        async function deleteSavedQuestion(id) {
            const token = getAuthToken();
            if (!confirm('Remove this saved question?')) return;
            try {
                const res = await fetch(`/api/saved-questions/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    await renderSavedQuestions();
                } else {
                    alert('Failed to remove saved question.');
                }
            } catch (e) {
                alert('Failed to remove saved question.');
            }
        }

        async function renderSavedQuestions() {
            const list = document.getElementById('saved-list');
            list.innerHTML = '<div class="history-empty">Loading saved questions...</div>';
            
            const saved = await fetchSavedQuestions();
            
            if (!saved || saved.length === 0) {
                list.innerHTML = '<div class="history-empty">No saved questions yet. When you miss a question during a quiz, you can save it to review here!</div>';
                return;
            }

            list.innerHTML = saved.map(entry => {
                const dateStr = formatQuizDate(entry.createdAt);
                return `
                    <div class="history-item">
                        <button class="history-delete-btn" onclick="deleteSavedQuestion('${entry._id}')" title="Remove">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                        <div class="history-meta" style="padding-right: 32px;">
                            <span class="history-title" style="white-space: normal; line-height: 1.4;">${escapeHtml(entry.question)}</span>
                            <span class="history-date">${dateStr}</span>
                        </div>
                        <div class="history-tags" style="margin-top: 10px;">
                            <span class="history-tag" style="color: var(--correct); font-weight: bold; border-color: var(--review-correct-border);">Correct Answer: ${escapeHtml(entry.correctAnswer)}</span>
                        </div>
                        ${entry.explanation ? `<div style="margin-top:10px; font-size: 0.9rem; color: var(--text-muted); background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px;"><strong>Explanation:</strong> ${escapeHtml(entry.explanation)}</div>` : ''}
                    </div>
                `;
            }).join('');
        }

        async function fetchLeaderboard() {
            try {
                const response = await fetch('/api/leaderboard');
                if (!response.ok) return [];
                return await response.json();
            } catch (e) {
                console.error('Failed to fetch leaderboard', e);
                return [];
            }
        }

        async function renderLeaderboard() {
            const list = document.getElementById('leaderboard-list');
            list.innerHTML = '<div class="history-empty">Loading leaderboard...</div>';
            
            const leaderboard = await fetchLeaderboard();
            
            if (!leaderboard || leaderboard.length === 0) {
                list.innerHTML = '<div class="history-empty">No one has taken any quizzes yet. Be the first!</div>';
                return;
            }

            list.innerHTML = leaderboard.map((entry, index) => {
                let rankTrophy = '';
                if (index === 0) rankTrophy = '🏆';
                else if (index === 1) rankTrophy = '🥈';
                else if (index === 2) rankTrophy = '🥉';
                else rankTrophy = `#${index + 1}`;

                return `
                    <div class="history-item">
                        <div class="history-meta" style="padding-right: 0;">
                            <span class="history-title" style="font-size: 1.1rem;">
                                <span style="display:inline-block; width: 30px; font-weight: 800; color: var(--primary);">${rankTrophy}</span> 
                                ${entry.name || 'Anonymous'}
                            </span>
                            <span class="history-score" style="font-size: 1.1rem; font-weight: 800;">
                                ${entry.percentage}%
                            </span>
                        </div>
                        <div class="history-tags">
                            <span class="history-tag">Total Score: ${entry.totalScore}</span>
                            <span class="history-tag">${entry.totalQuestions} Questions Answered</span>
                            <span class="history-tag">${entry.quizzesTaken} Quizzes Taken</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function formatQuizDate(isoDate) {
            return new Date(isoDate).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        }

        async function renderHistoryDashboard() {
            const session = getSession();
            const historyList = document.getElementById('history-list');
            const topicStrengthList = document.getElementById('topic-strength-list');
            const revisionList = document.getElementById('revision-list');

            if (!session) {
                renderTrendChart([]);
                historyList.innerHTML = '<div class="history-empty">Login to view your quiz history dashboard.</div>';
                if(topicStrengthList) topicStrengthList.innerHTML = '<li>Login to track strengths.</li>';
                if(revisionList) revisionList.innerHTML = '<li>Login for recommendations.</li>';
                return;
            }

            const history = await getQuizHistory();

            const attempts = history.length;
            renderTrendChart(history);

            const topicStats = history.reduce((acc, entry) => {
                if (!acc[entry.categoryLabel]) acc[entry.categoryLabel] = { total: 0, count: 0 };
                acc[entry.categoryLabel].total += entry.percentage;
                acc[entry.categoryLabel].count += 1;
                return acc;
            }, {});

            const sortedTopics = Object.entries(topicStats).map(([name, stats]) => ({
                name,
                avg: Math.round(stats.total / stats.count),
                count: stats.count
            })).sort((a, b) => b.avg - a.avg);

            if (!attempts) {
                historyList.innerHTML = '<div class="history-empty">No quiz attempts yet. Finish a quiz and your history will appear here.</div>';
                if(topicStrengthList) topicStrengthList.innerHTML = '<li>Take more quizzes to see your strengths!</li>';
                if(revisionList) revisionList.innerHTML = '<li>Take more quizzes to get recommendations!</li>';
                const chartContainer = document.getElementById('chart-container');
                if (chartContainer) chartContainer.style.display = 'none';
                return;
            }

            if (topicStrengthList && revisionList) {
                const strongTopics = sortedTopics.filter(t => t.avg >= 75);
                const weakTopics = sortedTopics.filter(t => t.avg < 75);

                if (strongTopics.length > 0) {
                    topicStrengthList.innerHTML = strongTopics.map(t => `<li><span style="color: var(--correct);">▲ ${t.name}</span> (${t.avg}%)</li>`).join('');
                } else {
                    topicStrengthList.innerHTML = '<li>Keep practicing to build your strong topics!</li>';
                }

                if (weakTopics.length > 0) {
                    revisionList.innerHTML = weakTopics.map(t => `<li><span style="color: var(--wrong);">▼ ${t.name}</span> (${t.avg}%) - Needs review</li>`).join('');
                } else {
                    revisionList.innerHTML = '<li>Great job! You have no weak topics.</li>';
                }
            }

            historyList.innerHTML = history.slice().reverse().map(entry => {
                const dateStr = formatQuizDate(entry.createdAt || entry.completedAt);
                return `
                    <div class="history-item">
                        <button class="history-delete-btn" onclick="deleteHistoryEntry('${entry._id}')" title="Delete quiz">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                        <div class="history-meta">
                            <span class="history-title">${entry.categoryLabel || 'Quiz'}</span>
                            <span class="history-date">${dateStr}</span>
                        </div>
                        <div class="history-tags">
                            <span class="history-tag">${entry.typeLabel || 'Local'}</span>
                            <span class="history-tag">${entry.difficultyLabel || 'Any'}</span>
                            <span class="history-tag">${entry.totalQuestions} Questions</span>
                            <span class="history-tag">${entry.answeredQuestions} Answered</span>
                        </div>
                        <div>Score: <span class="history-score">${entry.score} / ${entry.totalQuestions} (${entry.percentage}%)</span></div>
                    </div>
                `;
            }).join('');
        }

        function renderTrendChart(history) {
            const svg = document.getElementById('trend-chart');
            const tooltip = document.getElementById('chart-tooltip');
            if (!svg) return;
            
            svg.innerHTML = '';
            if (!history || history.length === 0) {
                svg.innerHTML = `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="var(--text-muted)">No quiz history yet.</text>`;
                return;
            }

            // Take the last 15 attempts for the chart
            const data = history.slice(-15);
            const padding = 30;
            const width = svg.clientWidth || 800; // fallback if invisible
            const height = svg.clientHeight || 220;

            const maxScore = 100;
            const minScore = 0;

            const dx = (width - padding * 2) / (Math.max(data.length - 1, 1));
            const dy = (height - padding * 2) / 100;

            let points = data.map((d, i) => {
                const x = padding + i * dx;
                const y = height - padding - (d.percentage * dy);
                return { x, y, val: d.percentage, label: d.categoryLabel };
            });

            let pathD = "";
            points.forEach((p, i) => {
                if (i === 0) {
                    pathD += `M ${p.x} ${p.y} `;
                } else {
                    const prev = points[i - 1];
                    const cp1x = prev.x + dx / 2;
                    const cp2x = p.x - dx / 2;
                    pathD += `C ${cp1x} ${prev.y}, ${cp2x} ${p.y}, ${p.x} ${p.y} `;
                }
            });

            // Grid lines
            for (let i = 0; i <= 100; i += 25) {
                const y = height - padding - (i * dy);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', padding);
                line.setAttribute('y1', y);
                line.setAttribute('x2', width - padding);
                line.setAttribute('y2', y);
                line.setAttribute('stroke', 'var(--option-border)');
                line.setAttribute('stroke-width', '1');
                line.setAttribute('stroke-dasharray', '4,4');
                svg.appendChild(line);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', padding - 10);
                text.setAttribute('y', y + 4);
                text.setAttribute('text-anchor', 'end');
                text.setAttribute('fill', 'var(--text-muted)');
                text.setAttribute('font-size', '12px');
                text.textContent = i;
                svg.appendChild(text);
            }

            // Fill gradient
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3" />
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.0" />
                </linearGradient>
            `;
            svg.appendChild(defs);

            // Area path
            if (points.length > 1) {
                const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const fillD = pathD + `L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
                areaPath.setAttribute('d', fillD);
                areaPath.setAttribute('fill', 'url(#chartGradient)');
                svg.appendChild(areaPath);
            }

            // Line
            const curveLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            curveLine.setAttribute('d', pathD);
            curveLine.setAttribute('fill', 'none');
            curveLine.setAttribute('stroke', 'var(--primary)');
            curveLine.setAttribute('stroke-width', '3');
            curveLine.setAttribute('stroke-linecap', 'round');
            curveLine.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(curveLine);

            // Points & Tooltips
            points.forEach((p, i) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', p.x);
                circle.setAttribute('cy', p.y);
                circle.setAttribute('r', '5');
                circle.setAttribute('fill', 'var(--card-bg)');
                circle.setAttribute('stroke', 'var(--primary)');
                circle.setAttribute('stroke-width', '2');
                circle.style.cursor = 'pointer';
                circle.style.transition = 'all 0.2s';
                
                circle.addEventListener('mouseenter', (e) => {
                    circle.setAttribute('r', '8');
                    if (tooltip) {
                        tooltip.style.display = 'block';
                        tooltip.innerHTML = `<div>${p.label || 'Quiz'}</div><div>${p.val}%</div>`;
                        tooltip.style.left = (p.x + 15) + 'px';
                        tooltip.style.top = (p.y - 15) + 'px';
                    }
                });

                circle.addEventListener('mouseleave', () => {
                    circle.setAttribute('r', '5');
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                });

                svg.appendChild(circle);
            });
        }

        async function storeQuizAttempt(score, totalQuestions, answeredQuestions) {
            if (!currentQuizConfig) return;
            const token = getAuthToken();
            if (!token) return;

            const percentage = totalQuestions === 0 ? 0 : Math.round((score / totalQuestions) * 100);
            const entry = {
                category: currentQuizConfig.category,
                categoryLabel: currentQuizConfig.categoryLabel,
                difficulty: currentQuizConfig.difficulty,
                difficultyLabel: currentQuizConfig.difficultyLabel,
                type: currentQuizConfig.type,
                typeLabel: currentQuizConfig.typeLabel,
                totalQuestions,
                answeredQuestions,
                score,
                percentage
            };

            try {
                await fetch('/api/history', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(entry)
                });
                await renderHistoryDashboard();
            } catch (e) {
                console.error('Failed to store attempt', e);
            }
        }

        async function updateAuthUI() {
            const session = getSession();

            if (session) {
                document.body.classList.add('authenticated');
                document.getElementById('welcome-name').textContent = session.name || session.email;
            } else {
                document.body.classList.remove('authenticated');
                document.getElementById('welcome-name').textContent = 'Player';
                document.getElementById('password').value = '';
            }

            await renderHistoryDashboard();
        }

        function setQuizPageDetails(config) {
            const title = document.getElementById('quiz-page-title');
            const subtitle = document.getElementById('quiz-page-subtitle');

            if (!config) {
                title.textContent = 'Your Quiz';
                subtitle.textContent = 'Answer each question before the timer runs out.';
                return;
            }

            title.textContent = `${config.categoryLabel} Quiz`;
            subtitle.textContent = `${config.typeLabel} - ${config.difficultyLabel} - ${config.requestedAmount} questions`;
        }

        function openQuizPage(config) {
            setQuizPageDetails(config);
            document.body.classList.add('quiz-active');
            document.body.classList.remove('review-active');
            window.scrollTo({ top: 0, behavior: 'smooth' });

            if (window.location.hash !== '#quiz') {
                history.pushState({ quizPage: true }, '', '#quiz');
            }
        }

        function closeQuizPage({ reset = true, updateUrl = true } = {}) {
            if (reset) {
                resetQuizUI(true);
            }

            document.body.classList.remove('quiz-active');
            document.body.classList.remove('review-active');
            setQuizPageDetails(null);

            if (updateUrl && ['#quiz', '#review'].includes(window.location.hash)) {
                history.replaceState({}, '', window.location.pathname + window.location.search);
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function resetQuizUI(keepQuizPageState = false) {
            clearInterval(timerInterval);
            currentQuizData = [];
            currentQuizConfig = null;
            currentWrongAnswers = [];
            currentReviewAnswers = [];
            document.getElementById('quiz-container').innerHTML = '';
            document.getElementById('results').innerHTML = '';
            document.getElementById('submit-btn').style.display = 'none';
            document.getElementById('loading').style.display = 'none';
            document.getElementById('timer-display').style.display = 'none';
            document.getElementById('timer-display').style.opacity = '1';
            document.getElementById('progress-bar-container').style.display = 'none';
            document.getElementById('progress-text').style.display = 'none';
            document.getElementById('progress-bar').style.width = '0%';
            document.getElementById('progress-text').textContent = '';
            document.getElementById('review-list').innerHTML = '';
            document.body.classList.remove('extreme-theme');

            if (!keepQuizPageState) {
                document.body.classList.remove('quiz-active');
                document.body.classList.remove('review-active');
                setQuizPageDetails(null);
            }
        }

        function closeReviewPage() {
            document.body.classList.remove('review-active');
            document.body.classList.add('quiz-active');

            if (window.location.hash === '#review') {
                history.replaceState({ quizPage: true }, '', '#quiz');
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function openReviewPage() {
            if (currentReviewAnswers.length === 0) {
                return;
            }

            renderReviewAnswers();
            document.body.classList.remove('quiz-active');
            document.body.classList.add('review-active');

            if (window.location.hash !== '#review') {
                history.pushState({ reviewPage: true }, '', '#review');
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function resetQuizDisplay(config) {
            const container = document.getElementById('quiz-container');
            const loading = document.getElementById('loading');
            const submitBtn = document.getElementById('submit-btn');
            const resultsDiv = document.getElementById('results');
            const timerDisplay = document.getElementById('timer-display');

            openQuizPage(config);
            currentWrongAnswers = [];
            currentReviewAnswers = [];
            container.innerHTML = '';
            resultsDiv.innerHTML = '';
            document.getElementById('review-list').innerHTML = '';
            submitBtn.style.display = 'none';
            timerDisplay.style.display = 'none';
            timerDisplay.style.opacity = '1';
            clearInterval(timerInterval);
            loading.style.display = 'block';
        }

        function applyQuizTheme(difficulty, type) {
            if (difficulty === 'extreme' && type === 'multiple-choice') {
                document.body.classList.add('extreme-theme');
            } else {
                document.body.classList.remove('extreme-theme');
            }
        }

        function normalizeGeneratedQuestions(questions, type) {
            return questions.map((question) => ({
                question: question.question,
                options: question.options,
                correctAnswer: question.correctAnswer,
                explanation: question.explanation || 'No explanation provided.',
                difficulty: type === 'true or false' ? 'true/false' : (question.difficulty || 'medium').toLowerCase()
            }));
        }

        function renderQuiz(questions, config) {
            const container = document.getElementById('quiz-container');
            const loading = document.getElementById('loading');
            const submitBtn = document.getElementById('submit-btn');
            setQuizPageDetails(config);

            if (questions.length === 0) {
                loading.style.display = 'none';
                container.innerHTML = '<p style="color: var(--wrong); text-align: center;">No questions found for this selection.</p>';
                return;
            }

            currentQuizData = questions;
            currentQuizConfig = config;
            loading.style.display = 'none';
            document.getElementById('progress-bar-container').style.display = 'block';
            document.getElementById('progress-text').style.display = 'block';
            updateProgressBar(0, questions.length);

            questions.forEach((q, index) => {
                const card = document.createElement('div');
                card.className = 'question-card';
                card.id = `card-${index}`;

                let html = `<h3>${index + 1}. ${q.question}</h3>`;

                q.options.forEach((opt) => {
                    let optionClass = 'option';
                    if (q.difficulty === 'true/false') {
                        optionClass += ' tf-option';
                    }

                    html += `<label class="${optionClass}"><input type="radio" name="question${index}" value="${opt}"> ${opt}</label>`;
                });

                card.innerHTML = html;
                card.querySelectorAll('input[type="radio"]').forEach((radio) => {
                    radio.addEventListener('change', () => {
                        const answered = document.querySelectorAll('input[type="radio"]:checked').length;
                        updateProgressBar(answered, currentQuizData.length);
                    });
                });
                container.appendChild(card);
            });

            submitBtn.style.display = 'block';
            startTimer(questions.length * 15);
        }

        function getLocalQuestions(category, amount, type, difficulty) {
            let allQuestions = questionBank[category] || [];

            const filteredQuestions = type === 'true or false'
                ? allQuestions.filter((q) => q.difficulty === 'true/false')
                : allQuestions.filter((q) => q.difficulty === difficulty);

            return [...filteredQuestions].sort(() => Math.random() - 0.5).slice(0, amount);
        }

        async function getGeminiQuestions(topic, amount, type, difficulty) {
            const response = await fetch('/api/generate-quiz', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    topic,
                    amount,
                    type,
                    difficulty
                })
            });

            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || 'Gemini quiz generation failed.');
            }

            return normalizeGeneratedQuestions(payload.questions || [], type);
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderReviewAnswers() {
            const reviewList = document.getElementById('review-list');

            if (currentReviewAnswers.length === 0) {
                reviewList.innerHTML = '<div class="review-empty">No answers to review yet.</div>';
                return;
            }

            reviewList.innerHTML = currentReviewAnswers
                .map((entry, index) => `
                    <article class="review-item ${entry.status}-review">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px;">
                            <h3 style="margin: 0; line-height: 1.4;">${index + 1}. ${escapeHtml(entry.question)}</h3>
                            ${(entry.status === 'wrong' || entry.status === 'skipped') ? 
                                `<button class="dashboard-tab" id="save-btn-${index}" onclick="saveQuestion(${index})" style="padding: 4px 12px; font-size: 0.85rem; flex-shrink: 0;">🔖 Save</button>` 
                                : ''}
                        </div>
                        <div class="review-options">
                            ${entry.options.map((option) => {
                                const isUserAnswer = entry.userAnswer === option;
                                const isCorrectAnswer = entry.correctAnswer === option;
                                const optionClasses = [
                                    'review-option',
                                    isUserAnswer ? 'user-answer' : '',
                                    isCorrectAnswer ? 'correct-answer' : '',
                                    isUserAnswer && !isCorrectAnswer ? 'wrong-answer' : ''
                                ].filter(Boolean).join(' ');
                                const shouldCheck = isUserAnswer || isCorrectAnswer;
                                const inputName = isCorrectAnswer && entry.userAnswer !== entry.correctAnswer
                                    ? `review${entry.index}-correct`
                                    : `review${entry.index}`;

                                return `
                                    <div class="${optionClasses}">
                                        <span class="review-option-text">
                                            <input type="radio" name="${inputName}" ${shouldCheck ? 'checked' : ''} disabled>
                                            ${escapeHtml(option)}
                                        </span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        ${entry.status === 'skipped' ? '<div class="review-row"><span>Your answer:</span> Skipped</div>' : ''}
                        <div class="review-row"><span>Explanation:</span> ${escapeHtml(entry.explanation)}</div>
                    </article>
                `)
                .join('');
        }

        async function saveQuestion(index) {
            const token = getAuthToken();
            const btn = document.getElementById(`save-btn-${index}`);
            if (!token || !btn) return;
            
            const entry = currentReviewAnswers[index];
            const data = {
                question: entry.question,
                options: entry.options,
                correctAnswer: entry.correctAnswer,
                explanation: entry.explanation
            };

            btn.disabled = true;
            btn.innerHTML = 'Saving...';

            try {
                const res = await fetch('/api/saved-questions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                if (res.ok) {
                    btn.innerHTML = 'Saved ✓';
                    btn.style.color = 'var(--correct)';
                    btn.style.borderColor = 'var(--correct)';
                } else {
                    btn.innerHTML = 'Error';
                    btn.disabled = false;
                }
            } catch (err) {
                console.error(err);
                btn.innerHTML = 'Error';
                btn.disabled = false;
            }
        }

        function startTimer(totalSeconds) {
            clearInterval(timerInterval);
            timeRemaining = totalSeconds;

            const timerDisplay = document.getElementById('timer-display');
            timerDisplay.style.display = 'block';

            timerInterval = setInterval(() => {
                timeRemaining--;

                const minutes = Math.floor(timeRemaining / 60);
                const seconds = timeRemaining % 60;
                const formattedSeconds = seconds < 10 ? '0' + seconds : seconds;

                timerDisplay.textContent = `Time Left: ${minutes}:${formattedSeconds}`;

                if (timeRemaining <= 10 && timeRemaining > 0) {
                    timerDisplay.style.opacity = timeRemaining % 2 === 0 ? '0.5' : '1';
                }

                if (timeRemaining <= 0) {
                    clearInterval(timerInterval);
                    timerDisplay.textContent = "Time's up!";
                    timerDisplay.style.opacity = '1';
                    calculateScore();
                }
            }, 1000);
        }

        function markAnswerOptions(card, selectedValue, correctAnswer) {
            card.querySelectorAll('.option').forEach((label) => {
                const input = label.querySelector('input[type="radio"]');
                if (!input) {
                    return;
                }

                if (input.value === correctAnswer) {
                    label.classList.add('correct-answer');
                    if (selectedValue && selectedValue !== correctAnswer) {
                        input.name = `${input.name}-correct`;
                        input.checked = true;
                    }
                }

                if (selectedValue && input.value === selectedValue) {
                    label.classList.add('user-answer');
                    input.checked = true;
                    if (selectedValue !== correctAnswer) {
                        label.classList.add('wrong-answer');
                    }
                }
            });
        }

        function backToDashboardFromSummary() {
            document.body.classList.remove('summary-active');
            window.scrollTo(0, 0);
        }

        async function fetchSummary() {
            if (!getSession()) {
                alert('Please login before generating a summary.');
                return;
            }

            const source = getQuizSource();
            let url = '/api/generate-summary';
            let options = { method: 'POST' };

            const summaryBtn = document.querySelector('button[onclick="fetchSummary()"]');
            const originalButtonText = summaryBtn.textContent;
            summaryBtn.textContent = 'Generating...';
            summaryBtn.disabled = true;

            try {
                const category = document.getElementById('category').value;
                const customTopic = document.getElementById('custom-topic').value;
                let topic = source === 'gemini' ? (customTopic || 'general knowledge') : category;
                options.headers = { 'Content-Type': 'application/json' };
                options.body = JSON.stringify({ topic });

                const response = await fetch(url, options);
                const data = await response.text();

                if (!response.ok) {
                    try {
                        const jsonData = JSON.parse(data);
                        throw new Error(jsonData.error || 'Failed to generate summary.');
                    } catch (e) {
                        throw new Error('Failed to generate summary.');
                    }
                }

                document.getElementById('summary-content').innerHTML = data;
                document.body.classList.add('summary-active');
                window.scrollTo(0, 0);
            } catch (error) {
                alert(error.message);
            } finally {
                summaryBtn.textContent = originalButtonText;
                summaryBtn.disabled = false;
            }
        }

        async function fetchQuiz() {
            if (!getSession()) {
                setAuthMessage('Please login before generating a quiz.', 'error');
                updateAuthUI();
                return;
            }

            setAuthMessage('');

            const source = getQuizSource();
            const category = document.getElementById('category').value;
            const customTopic = document.getElementById('custom-topic').value.trim();
            const amount = parseInt(document.getElementById('amount').value, 10);
            const type = document.getElementById('type').value;
            const difficulty = document.getElementById('difficulty').value;
            const selectedCategoryLabel = document.getElementById('category').selectedOptions[0].textContent;
            const selectedTypeLabel = document.getElementById('type').selectedOptions[0].textContent;
            const selectedDifficultyLabel = type === 'true or false'
                ? 'True / False'
                : document.getElementById('difficulty').selectedOptions[0].textContent;
            let topic, topicLabel;

            if (source === 'gemini' && customTopic) {
                topic = customTopic;
                topicLabel = customTopic;
            } else {
                topic = category;
                topicLabel = selectedCategoryLabel;
            }

            const quizConfig = {
                source,
                category: topic,
                categoryLabel: topicLabel,
                type,
                typeLabel: selectedTypeLabel,
                difficulty,
                difficultyLabel: selectedDifficultyLabel,
                requestedAmount: amount
            };

            applyQuizTheme(difficulty, type);
            resetQuizDisplay(quizConfig);

            try {
                let questions = [];

                if (source === 'gemini') {
                    questions = await getGeminiQuestions(topic, amount, type, difficulty);
                } else {
                    questions = getLocalQuestions(category, amount, type, difficulty);
                }

                renderQuiz(questions, quizConfig);
            } catch (error) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('quiz-container').innerHTML = `<p style="color: var(--wrong); text-align: center; font-weight: bold;">${error.message || 'Error loading quiz data.'}</p>`;
                console.error(error);
            }
        }

        function calculateScore() {
            clearInterval(timerInterval);

            if (currentQuizData.length === 0) {
                return;
            }

            let score = 0;
            let answeredQuestions = 0;
            currentWrongAnswers = [];
            currentReviewAnswers = [];
            const resultsDiv = document.getElementById('results');
            const submitBtn = document.getElementById('submit-btn');
            const isExtreme = document.body.classList.contains('extreme-theme');

            currentQuizData.forEach((q, index) => {
                const selectedOption = document.querySelector(`input[name="question${index}"]:checked`);
                const userAnswer = selectedOption ? selectedOption.value : 'Skipped';
                const isCorrectAnswer = selectedOption && selectedOption.value === q.correctAnswer;
                const card = document.getElementById(`card-${index}`);

                if (!card) {
                    return;
                }

                currentReviewAnswers.push({
                    index,
                    question: q.question,
                    options: q.options,
                    userAnswer,
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation,
                    status: !selectedOption ? 'skipped' : (isCorrectAnswer ? 'correct' : 'wrong')
                });

                if (selectedOption) {
                    answeredQuestions++;
                    if (isCorrectAnswer) {
                        score++;
                        card.style.borderColor = 'var(--correct)';
                        markAnswerOptions(card, selectedOption.value, q.correctAnswer);
                    } else {
                        currentWrongAnswers.push({
                            index,
                            question: q.question,
                            userAnswer: selectedOption.value,
                            correctAnswer: q.correctAnswer,
                            explanation: q.explanation,
                            options: q.options
                        });
                        card.style.borderColor = 'var(--wrong)';
                        card.innerHTML += `
                            <div style="margin-top: 10px; font-size: 0.95rem; color: var(--text-muted);"><em><strong>Explanation:</strong> ${q.explanation}</em></div>
                        `;
                        markAnswerOptions(card, selectedOption.value, q.correctAnswer);
                    }
                } else {
                    currentWrongAnswers.push({
                        index,
                        question: q.question,
                        userAnswer: 'Skipped',
                        correctAnswer: q.correctAnswer,
                        explanation: q.explanation,
                        options: q.options
                    });
                    card.style.borderColor = '#f59e0b';
                    card.innerHTML += `
                        <div style="margin-top: 10px; font-size: 0.95rem; color: var(--text-muted);"><em><strong>Explanation:</strong> ${q.explanation}</em></div>
                    `;
                    markAnswerOptions(card, null, q.correctAnswer);
                }

                card.querySelectorAll('input[type="radio"]').forEach((radio) => {
                    radio.disabled = true;
                });
            });

            resultsDiv.style.background = 'var(--card-bg)';
            resultsDiv.style.padding = '20px';
            resultsDiv.style.borderRadius = '12px';
            resultsDiv.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)';
            resultsDiv.innerHTML = `
                You scored ${score} out of ${currentQuizData.length}! (${Math.round((score / currentQuizData.length) * 100)}%)
                <div style="margin-top: 14px;">
                    <button type="button" id="review-wrong-btn">Review Answers</button>
                </div>
            `;

            submitBtn.style.display = 'none';
            updateProgressBar(currentQuizData.length, currentQuizData.length);
            storeQuizAttempt(score, currentQuizData.length, answeredQuestions);
            document.getElementById('review-wrong-btn').addEventListener('click', openReviewPage);
        }

        function updateProgressBar(answered, total) {
            const percent = total === 0 ? 0 : (answered / total) * 100;
            document.getElementById('progress-bar').style.width = percent + '%';
            document.getElementById('progress-text').textContent = total === 0 ? '' : `Question ${answered} of ${total}`;
        }

        document.getElementById('login-tab').addEventListener('click', () => setAuthMode('login'));
        document.getElementById('signup-tab').addEventListener('click', () => setAuthMode('signup'));
        document.getElementById('quiz-source').addEventListener('change', updateQuizSourceUI);
        document.getElementById('back-home-btn').addEventListener('click', () => closeQuizPage());
        document.getElementById('back-to-results-btn').addEventListener('click', closeReviewPage);
        document.getElementById('review-dashboard-btn').addEventListener('click', () => closeQuizPage({ reset: true }));

        window.addEventListener('popstate', () => {
            if (window.location.hash === '#review' && currentReviewAnswers.length > 0) {
                renderReviewAnswers();
                document.body.classList.remove('quiz-active');
                document.body.classList.add('review-active');
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            if (window.location.hash === '#quiz' && currentQuizData.length > 0) {
                document.body.classList.remove('review-active');
                document.body.classList.add('quiz-active');
                setQuizPageDetails(currentQuizConfig);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            if (document.body.classList.contains('quiz-active') || document.body.classList.contains('review-active')) {
                resetQuizUI(true);
                document.body.classList.remove('quiz-active');
                document.body.classList.remove('review-active');
                setQuizPageDetails(null);
            }
        });

        document.getElementById('auth-form').addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim().toLowerCase();
            const password = document.getElementById('password').value;

            if (!email || !password) {
                setAuthMessage('Email and password are required.', 'error');
                return;
            }

            if (password.length < 6) {
                setAuthMessage('Password must be at least 6 characters long.', 'error');
                return;
            }

            const authBtn = document.getElementById('auth-submit');
            const originalBtnText = authBtn.textContent;
            authBtn.textContent = 'Please wait...';
            authBtn.disabled = true;

            try {
                if (authMode === 'signup') {
                    if (!name) {
                        setAuthMessage('Please add your name to create the account.', 'error');
                        authBtn.textContent = originalBtnText;
                        authBtn.disabled = false;
                        return;
                    }

                    const res = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email, password })
                    });
                    const data = await res.json();
                    
                    if (!res.ok) throw new Error(data.error || 'Registration failed');

                    setSession(data.token, data.user);
                    setAuthMessage('Account created. You are now logged in.', 'success');
                    event.target.reset();
                    setAuthMode('login');
                } else {
                    const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    const data = await res.json();
                    
                    if (!res.ok) throw new Error(data.error || 'Login failed');

                    setSession(data.token, data.user);
                    setAuthMessage('Welcome back. Login successful.', 'success');
                    event.target.reset();
                }
            } catch (err) {
                setAuthMessage(err.message, 'error');
            } finally {
                authBtn.textContent = originalBtnText;
                authBtn.disabled = false;
            }
        });

        document.getElementById('logout-btn').addEventListener('click', logout);

        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        let currentTheme = localStorage.getItem('theme') || 'light';
        if (currentTheme === 'dark') {
            document.body.classList.add('dark-theme');
            themeToggleBtn.textContent = 'Light';
            themeToggleBtn.setAttribute('aria-label', 'Switch to light mode');
        }

        themeToggleBtn.addEventListener('click', () => {
            // If extreme theme is active, don't toggle to dark mode
            if (document.body.classList.contains('extreme-theme')) {
                alert('Dark mode toggle is disabled in Extreme mode.');
                return;
            }
            if (document.body.classList.contains('dark-theme')) {
                document.body.classList.remove('dark-theme');
                localStorage.setItem('theme', 'light');
                themeToggleBtn.textContent = 'Dark';
                themeToggleBtn.setAttribute('aria-label', 'Switch to dark mode');
            } else {
                document.body.classList.add('dark-theme');
                localStorage.setItem('theme', 'dark');
                themeToggleBtn.textContent = 'Light';
                themeToggleBtn.setAttribute('aria-label', 'Switch to light mode');
            }
        });

        document.getElementById('clear-history-btn').addEventListener('click', async () => {
            if (!confirm('Are you sure you want to clear all your quiz history? This cannot be undone.')) return;
            
            const token = getAuthToken();
            if (!token) return;

            try {
                const response = await fetch('/api/history', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (response.ok) {
                    await renderHistoryDashboard();
                } else {
                    alert('Failed to clear history');
                }
            } catch (err) {
                console.error('Error clearing history:', err);
                alert('An error occurred while clearing history');
            }
        });

        setAuthMode('login');
        updateQuizSourceUI();
        updateAuthUI();

        // --- Anti-Cheat System ---
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && document.body.classList.contains('quiz-active')) {
                // User switched tabs while quiz is active
                handleCheating();
            }
        });

        function handleCheating() {
            // Auto-submit the quiz
            calculateScore();
            // Show the warning overlay
            document.getElementById('anti-cheat-overlay').style.display = 'flex';
        }

        function dismissCheatWarning() {
            document.getElementById('anti-cheat-overlay').style.display = 'none';
            closeQuizPage();
        }

        // ============================================================================
        // 🎮 MULTIPLAYER ROOM CLIENT LOGIC (SOCKET.IO)
        // ============================================================================

        const socket = typeof io !== 'undefined' ? io() : null;
        let activeRoomState = null;
        let roomTimerInterval = null;

        function openHostModal() {
            showMultiplayerShellView('room-host-form');
        }

        function closeHostModal() {
            closeMultiplayerRoom();
        }

        function openJoinModal() {
            showMultiplayerShellView('room-join-form');
            const err = document.getElementById('join-error-msg');
            if (err) err.style.display = 'none';
            const codeInput = document.getElementById('join-code');
            if (codeInput) {
                codeInput.value = '';
                setTimeout(() => codeInput.focus(), 100);
            }
        }

        function closeJoinModal() {
            closeMultiplayerRoom();
        }

        function submitCreateRoom() {
            if (!socket) {
                alert('Socket connection unavailable.');
                return;
            }
            const topic = document.getElementById('host-topic').value;
            const amount = Number(document.getElementById('host-amount').value);
            const timePerQuestion = Number(document.getElementById('host-timer').value);

            // Fetch questions from questionBank locally or generate fallback
            let questions = [];
            if (typeof questionBank !== 'undefined' && questionBank[topic]) {
                questions = questionBank[topic].slice(0, amount);
            } else if (typeof questionBank !== 'undefined') {
                const keys = Object.keys(questionBank);
                if (keys.length > 0) questions = questionBank[keys[0]].slice(0, amount);
            }

            if (questions.length === 0) {
                alert('No predefined questions found for this topic.');
                return;
            }

            socket.emit('create_room', {
                title: `${topic.toUpperCase()} Live Quiz`,
                questions,
                timePerQuestion
            });
        }

        function submitJoinRoom() {
            if (!socket) {
                alert('Socket connection unavailable.');
                return;
            }
            const codeInput = document.getElementById('join-code').value.replace(/\D/g, '').trim();
            const nicknameInput = document.getElementById('join-nickname').value.trim();

            if (!codeInput || codeInput.length !== 6) {
                const err = document.getElementById('join-error-msg');
                if (err) {
                    err.textContent = 'Please enter a valid 6-digit room code.';
                    err.style.display = 'block';
                }
                return;
            }

            const currentUser = typeof getSession === 'function' ? getSession() : null;
            const defaultName = currentUser ? currentUser.name : '';
            const finalNickname = nicknameInput || defaultName || 'Player_' + Math.floor(100 + Math.random() * 900);

            socket.emit('join_room', {
                roomCode: codeInput,
                nickname: finalNickname
            });
        }

        function startHostRoomQuiz() {
            if (socket) {
                socket.emit('start_room_quiz');
            }
        }

        function closeMultiplayerRoom() {
            if (roomTimerInterval) clearInterval(roomTimerInterval);
            if (socket && activeRoomState) {
                socket.emit('leave_room');
            }
            document.body.classList.remove('multiplayer-active');
            const mpPage = document.getElementById('multiplayer-page');
            if (mpPage) mpPage.style.display = 'none';
            ['room-host-lobby', 'room-player-waiting', 'room-live-question', 'room-intermission', 'room-game-over', 'room-host-form', 'room-join-form'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            activeRoomState = null;
            window.scrollTo(0, 0);
        }

        function showMultiplayerShellView(viewId) {
            document.body.classList.remove('quiz-active', 'review-active', 'summary-active');
            document.body.classList.add('multiplayer-active');
            const mpPage = document.getElementById('multiplayer-page');
            if (mpPage) {
                mpPage.scrollTop = 0;
            }

            ['room-host-lobby', 'room-player-waiting', 'room-live-question', 'room-intermission', 'room-game-over', 'room-host-form', 'room-join-form'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = id === viewId ? 'block' : 'none';
            });
        }

        function escapeRoomHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, (char) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
        }

        // --- Socket Listeners ---
        if (socket) {
            socket.on('room_created', (data) => {
                activeRoomState = { roomCode: data.roomCode, isHost: true };
                const codeDisp = document.getElementById('room-code-display');
                if (codeDisp) codeDisp.textContent = data.roomCode;
                const countBadge = document.getElementById('lobby-count-badge');
                if (countBadge) countBadge.textContent = '1 Player Connected';
                const playerList = document.getElementById('lobby-player-list');
                if (playerList) playerList.innerHTML = '<span class="player-chip">👑 Host</span>';
                showMultiplayerShellView('room-host-lobby');
            });

            socket.on('room_joined', (data) => {
                activeRoomState = { roomCode: data.roomCode, isHost: false, nickname: data.nickname };
                const joinForm = document.getElementById('room-join-form');
                if (joinForm) joinForm.style.display = 'none';
                const pCodeDisp = document.getElementById('player-room-code-display');
                if (pCodeDisp) pCodeDisp.textContent = data.roomCode;
                const pCountBadge = document.getElementById('player-lobby-count-badge');
                if (pCountBadge) pCountBadge.textContent = `${data.playerCount} Players in Lobby`;
                showMultiplayerShellView('room-player-waiting');
            });

            socket.on('lobby_update', (data) => {
                const playerChips = data.players.map(p => `<span class="player-chip">👤 ${p}</span>`).join('');
                if (activeRoomState && activeRoomState.isHost) {
                    const countBadge = document.getElementById('lobby-count-badge');
                    if (countBadge) countBadge.textContent = `${data.playerCount} Players Connected`;
                    const playerList = document.getElementById('lobby-player-list');
                    if (playerList) playerList.innerHTML = playerChips;
                } else {
                    const pCountBadge = document.getElementById('player-lobby-count-badge');
                    if (pCountBadge) pCountBadge.textContent = `${data.playerCount} Players in Lobby`;
                    const pWaitList = document.getElementById('player-waiting-list');
                    if (pWaitList) pWaitList.innerHTML = playerChips;
                }
            });

            socket.on('question_start', (data) => {
                showMultiplayerShellView('room-live-question');
                const qProgress = document.getElementById('room-q-progress');
                if (qProgress) qProgress.textContent = `Question ${data.questionIndex + 1} / ${data.totalQuestions}`;
                
                const qProgressBar = document.getElementById('room-q-progress-bar');
                if (qProgressBar) {
                    const pct = Math.round(((data.questionIndex + 1) / data.totalQuestions) * 100);
                    qProgressBar.style.width = `${pct}%`;
                }

                const qText = document.getElementById('room-question-text');
                if (qText) qText.textContent = data.question;

                const optionsContainer = document.getElementById('room-options-container');
                if (optionsContainer) {
                    optionsContainer.innerHTML = '';
                    data.options.forEach((opt, idx) => {
                        const btn = document.createElement('button');
                        btn.className = 'mp-opt-card';
                        btn.innerHTML = `<span class="mp-opt-badge">${String.fromCharCode(65 + idx)}</span> <span>${escapeRoomHtml(opt)}</span>`;
                        btn.onclick = () => submitRoomOptAnswer(btn, opt, data.timePerQuestion, data.startTime);
                        optionsContainer.appendChild(btn);
                    });
                }

                const ansStatus = document.getElementById('room-answer-status');
                if (ansStatus) {
                    ansStatus.textContent = 'Select your answer above!';
                    ansStatus.style.color = 'var(--text-muted)';
                }

                // Synced timer countdown
                if (roomTimerInterval) clearInterval(roomTimerInterval);
                let secondsLeft = data.timePerQuestion;
                const timerBadge = document.getElementById('room-timer-badge');
                if (timerBadge) {
                    timerBadge.textContent = `${secondsLeft}s`;
                    timerBadge.classList.remove('timer-warning', 'timer-danger');
                }

                let autoSubmitted = false;
                roomTimerInterval = setInterval(() => {
                    secondsLeft -= 1;
                    if (secondsLeft >= 0) {
                        if (timerBadge) {
                            timerBadge.textContent = `${secondsLeft}s`;
                            if (secondsLeft <= 5) {
                                timerBadge.classList.add('timer-danger');
                            } else if (secondsLeft <= 10) {
                                timerBadge.classList.add('timer-warning');
                            }
                        }
                    } else {
                        clearInterval(roomTimerInterval);
                        if (!autoSubmitted) {
                            autoSubmitted = true;
                            submitRoomOptAnswer(null, null, data.timePerQuestion, data.startTime);
                        }
                    }
                }, 1000);
            });

            function submitRoomOptAnswer(selectedBtn, selectedOpt, totalTime, startTime) {
                if (!activeRoomState) return;

                // Disable all buttons in container
                const allBtns = document.querySelectorAll('.mp-opt-card, .room-opt-btn');
                allBtns.forEach(b => {
                    b.disabled = true;
                    b.style.opacity = '0.6';
                });

                if (selectedBtn) {
                    selectedBtn.classList.add('selected');
                    selectedBtn.style.opacity = '1';
                }

                const elapsedSeconds = startTime ? (Date.now() - startTime) / 1000 : totalTime;
                socket.emit('submit_room_answer', {
                    selectedOption: selectedOpt || '',
                    answerTimeSeconds: elapsedSeconds
                });

                const ansStatus = document.getElementById('room-answer-status');
                if (ansStatus) {
                    ansStatus.textContent = selectedOpt ? '✓ Answer submitted! Waiting for round to finish...' : '⏱️ Time\'s up! Waiting for round to finish...';
                    ansStatus.style.color = selectedOpt ? 'var(--primary)' : '#f59e0b';
                }
            }

            socket.on('question_ended', (data) => {
                if (roomTimerInterval) clearInterval(roomTimerInterval);
                showMultiplayerShellView('room-intermission');
                const corrAns = document.getElementById('intermission-correct-ans');
                if (corrAns) corrAns.textContent = data.correctAnswer;
                const expl = document.getElementById('intermission-explanation');
                if (expl) expl.textContent = data.explanation;

                const standingsEl = document.getElementById('room-standings-list');
                if (standingsEl) {
                    standingsEl.innerHTML = data.leaderboard.map((item, idx) => `
                        <div class="standing-item">
                            <span>#${idx + 1} ${escapeRoomHtml(item.name)} ${item.streak > 1 ? '🔥 ' + item.streak : ''}</span>
                            <span>${item.score} pts</span>
                        </div>
                    `).join('');
                }
            });

            socket.on('room_game_over', (data) => {
                if (roomTimerInterval) clearInterval(roomTimerInterval);
                showMultiplayerShellView('room-game-over');

                const podiumEl = document.getElementById('podium-container');
                if (podiumEl) {
                    podiumEl.innerHTML = (data.podium || []).map((p, idx) => `
                        <div class="podium-card">
                            <div class="podium-rank">${idx === 0 ? '🥇 1st' : idx === 1 ? '🥈 2nd' : '🥉 3rd'}</div>
                            <div style="font-weight:700; margin-top:6px; color:var(--text-main);">${escapeRoomHtml(p.name)}</div>
                            <div style="color:var(--primary); font-weight:800; font-size:1.1rem; margin-top:4px;">${p.score} pts</div>
                        </div>
                    `).join('');
                }

                const finalRankingsEl = document.getElementById('final-rankings-list');
                if (finalRankingsEl) {
                    finalRankingsEl.innerHTML = (data.leaderboard || []).map((item, idx) => `
                        <div class="standing-item">
                            <span>#${idx + 1} ${escapeRoomHtml(item.name)}</span>
                            <span>${item.score} pts</span>
                        </div>
                    `).join('');
                }
            });

            socket.on('room_error', (data) => {
                const joinErr = document.getElementById('join-error-msg');
                const joinForm = document.getElementById('room-join-form');
                if (joinErr && joinForm && joinForm.style.display === 'block') {
                    joinErr.textContent = data.message;
                    joinErr.style.display = 'block';
                } else {
                    alert(data.message || 'Room error occurred');
                }
            });
        }

        window.openHostModal = openHostModal;
        window.closeHostModal = closeHostModal;
        window.openJoinModal = openJoinModal;
        window.closeJoinModal = closeJoinModal;
        window.submitCreateRoom = submitCreateRoom;
        window.submitJoinRoom = submitJoinRoom;
        window.startHostRoomQuiz = startHostRoomQuiz;
        window.closeMultiplayerRoom = closeMultiplayerRoom;
