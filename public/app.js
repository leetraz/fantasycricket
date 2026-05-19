let matchData = null;
const valueLabelsPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            meta.data.forEach((point, index) => {
                const value = dataset.data[index];
                if (value === null || value === undefined || value === 0 || value === "0" || value === "null") return;
                
                const text = (dataset.label.includes('Runs') ? '' : 'W:') + value;
                ctx.font = '900 12px "Space Grotesk"';
                const textWidth = ctx.measureText(text).width;
                
                const x = point.x;
                const y = point.y - 18;

                // Draw pill background
                ctx.fillStyle = dataset.borderColor || 'rgba(0,0,0,0.8)';
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(x - textWidth/2 - 6, y - 10, textWidth + 12, 20, 6);
                } else {
                    ctx.rect(x - textWidth/2 - 6, y - 10, textWidth + 12, 20);
                }
                ctx.fill();
                
                // Draw text
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, x, y);
            });
        });
        ctx.restore();
    }
};

let currentChart = null;
let currentH2HChart = null;
let comparisonChart = null;

const STUMP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M5 3v18M12 3v18M19 3v18M5 7h14M5 11h14"/></svg>`;

async function init() {
    fetchMatches();
}

async function fetchMatches() {
    try {
        const response = await fetch('/api/list-matches');
        const matches = await response.json();
        renderMatches(matches);
    } catch (e) {
        console.error(e);
        document.getElementById('matches-list').innerHTML = '<div class="loading-matches"><p class="error">Failed to fetch matches. Please try manual URL.</p></div>';
    }
}

function renderMatches(matches) {
    const list = document.getElementById('matches-list');
    list.innerHTML = '';

    if (!matches || matches.length === 0) {
        list.innerHTML = '<div class="loading-matches"><p>No live or upcoming matches found. Please enter a URL manually.</p></div>';
        return;
    }

    matches.forEach((match, index) => {
        const card = document.createElement('div');
        card.className = 'match-select-card glass';
        card.style.animationDelay = `${index * 0.1}s`;
        card.onclick = () => loadMatch(match.url, match.title);
        
        const dateStr = match.startTime ? new Date(match.startTime).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
        const timeStr = match.startTime ? new Date(match.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        card.innerHTML = `
            <div class="match-date" style="font-size: 0.8rem; opacity: 0.6; margin-bottom: 0.5rem; font-weight: 600;">${dateStr} | ${timeStr}</div>
            <div class="match-series" style="font-size: 0.7rem; color: var(--accent-purple); font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">${match.series}</div>
            <div class="match-teams">${match.title}</div>
            <div class="match-status" style="color: ${match.status.toLowerCase().includes('live') ? '#ef4444' : '#10b981'}">
                ${match.status.toLowerCase().includes('live') ? '● LIVE' : match.status}
            </div>
        `;
        list.appendChild(card);
    });
}

function showSelector() {
    document.getElementById('match-selector').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

function loadCustomMatch() {
    const url = document.getElementById('custom-url').value;
    if (url) loadMatch(url, "Custom Match");
    else alert("Please enter a valid Cricinfo match URL.");
}

async function loadMatch(url, title) {
    console.log("loadMatch called with:", { url, title });
    try {
        const selector = document.getElementById('match-selector');
        const dashboard = document.getElementById('dashboard');
        const loader = document.getElementById('loader');
        const mainContent = document.getElementById('main-content');

        if (!selector || !dashboard || !loader || !mainContent) {
            console.error("Missing UI elements", { selector, dashboard, loader, mainContent });
            return;
        }

        selector.classList.add('hidden');
        dashboard.classList.remove('hidden');
        loader.classList.remove('hidden');
        mainContent.classList.add('hidden');

        const headerTitle = document.getElementById('header-title');
        const headerSubtitle = document.getElementById('header-subtitle');

        if (headerTitle && headerSubtitle) {
            if (title) {
                headerTitle.innerText = title;
            } else {
                headerTitle.innerText = "INITIALIZING ANALYSIS...";
            }
        }

        const response = await fetch(`/api/match-data?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        if (data.error) {
            alert("Error: " + data.error);
            showSelector();
            return;
        }

        matchData = data;
        renderUI();
    } catch (e) {
        console.error("loadMatch Error:", e);
        alert("Connectivity Error: " + e.message);
        showSelector();
    }
}

function renderUI() {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('main-content').classList.remove('hidden');

    const matchName = matchData.teams.join(' vs ');
    document.getElementById('header-title').innerText = matchName;
    document.getElementById('header-subtitle').innerText = `Evidence-based analytics for ${matchName} at ${matchData.ground}`;

    // Update section title with match name
    document.querySelectorAll('.section-title').forEach(title => {
        if (title.innerText.includes('Team Performance Comparison')) {
            title.innerText = `${matchName} Performance Comparison`;
        }
    });

    renderTeamGrid('recent-team-grid', matchData.recentTeam, 'recent');
    renderTeamGrid('h2h-team-grid', matchData.h2hTeam, 'h2h');
    renderAllPlayersDetailedList();

    // Update bulk buttons
    if (matchData.teams && matchData.teams.length >= 2) {
        document.getElementById('bulk-btn-a').innerHTML = `<span class="btn-icon">🚀</span> OPEN ALL ${matchData.teams[0]} PLAYERS`;
        document.getElementById('bulk-btn-b').innerHTML = `<span class="btn-icon">🚀</span> OPEN ALL ${matchData.teams[1]} PLAYERS`;
    }
}

function renderTeamGrid(gridId, players, type) {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';

    players.forEach((player, index) => {
        const card = document.createElement('div');
        const isFirst = index === 0;
        card.className = `player-card glass ${isFirst ? 'active' : ''}`;
        card.style.animation = `fadeInUp 0.6s cubic-bezier(0.23, 1, 0.32, 1) both ${index * 0.05}s`;
        card.addEventListener('click', (e) => {
            selectPlayer(player, card);
            // Open in new tab
            const opponent = matchData.teams.find(t => t !== player.team);
            const url = `player.html?pid=${player.player_id}&objectId=${player.object_id}&name=${encodeURIComponent(player.name)}&role=${encodeURIComponent(player.role)}&opponent=${encodeURIComponent(opponent)}`;
            window.open(url, '_blank');
        });

        let badges = '';
        if (player.isCaptain) badges += '<span class="badge-c">C</span>';
        if (player.isViceCaptain) badges += '<span class="badge-vc">VC</span>';

        const statsToUse = type === 'h2h' ? player.h2hStats : player.stats;
        
        // For H2H, we want the BEST performance, not just the latest
        let lastScore;
        if (type === 'h2h' && statsToUse && statsToUse.length > 0) {
            lastScore = [...statsToUse].sort((a, b) => {
                const scoreA = (parseInt(a.bat) || 0) + (parseInt(a.bowl) * 25);
                const scoreB = (parseInt(b.bat) || 0) + (parseInt(b.bowl) * 25);
                return scoreB - scoreA;
            })[0];
        } else {
            lastScore = statsToUse && statsToUse.length > 0 ? statsToUse[0] : { bat: '-', bowl: '-' };
        }
        
        const batVal = lastScore.bat || '0';
        const bowlVal = lastScore.bowl || '0';

        const isTeamA = matchData.teams && player.team === matchData.teams[0];
        const themeColor = isTeamA ? '#3b82f6' : '#f43f5e';
        const themeColorAlpha = isTeamA ? 'rgba(59, 130, 246, 0.1)' : 'rgba(244, 63, 94, 0.1)';
        
        card.style.borderLeft = `6px solid ${themeColor}`;

        const opponent = matchData.teams.find(t => t !== player.team) || 'Opponent';
        card.innerHTML = `
            ${badges}
            <div class="player-info" style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div onclick="openPlayerProfile('${player.player_id}', '${player.object_id}', '${player.name.replace(/'/g, "\\'")}', '${player.role.replace(/'/g, "\\'")}', '${opponent.replace(/'/g, "\\'")}')">
                    <h4 class="clickable-name" style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0; cursor: pointer; color: var(--neon-blue); text-decoration: underline; text-underline-offset: 4px;">${player.name}</h4>
                    <span class="player-team" style="font-size: 0.9rem; opacity: 0.8; font-weight: 500;">${player.team} | ${player.role}</span>
                </div>
                <div style="background: ${themeColorAlpha}; color: ${themeColor}; padding: 0.4rem 0.8rem; border-radius: 1rem; font-weight: 900; border: 1px solid ${themeColor}44; font-size: 0.9rem;">
                    ${player.pickScore}%
                </div>
            </div>
            
            <div class="last-match-spotlight" style="margin: 1.5rem 0 1rem 0; text-align: center; background: rgba(15, 23, 42, 0.6); padding: 1.5rem 1rem; border-radius: 1.25rem; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.2em; color: #64748b; margin-bottom: 0.75rem; font-weight: 700;">${type === 'h2h' ? 'Best H2H Performance' : 'Last Match Score'}</div>
                <div style="display: flex; justify-content: center; gap: 2.5rem; align-items: center;">
                    <div style="text-align: center;">
                        <div style="font-size: 2.5rem; font-weight: 900; color: #ffffff; line-height: 1; filter: drop-shadow(0 4px 10px rgba(255,255,255,0.2));">${batVal}</div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.4rem; font-weight: 700; letter-spacing: 0.1em;">RUNS</div>
                    </div>
                    <div style="width: 1px; height: 40px; background: rgba(255,255,255,0.1);"></div>
                    <div style="text-align: center;">
                        <div style="font-size: 2.5rem; font-weight: 900; color: ${themeColor}; line-height: 1; filter: drop-shadow(0 4px 10px ${themeColor}66);">${bowlVal}</div>
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.4rem; font-weight: 700; letter-spacing: 0.1em;">WKTS</div>
                    </div>
                </div>
            </div>
        `;

        const chartBlock = `
                <div id="charts-${gridId}-${player.object_id}">
                    ${type === 'h2h' ? `
                    <div style="display: flex; justify-content: center; align-items: center; margin-top: 1rem;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; margin-bottom: 0.5rem; font-weight: 700; text-align: center;">Strict H2H Neural Trend</div>
                            <div class="mini-chart-wrapper" style="height: 100px; width: 100%; position: relative;">
                                ${player.h2hStats && player.h2hStats.length > 0 ? `<canvas id="card-chart-h2h-${gridId}-${player.object_id}"></canvas>` : '<p style="font-size: 0.7rem; text-align: center; color: #64748b; padding-top: 40px; font-weight: 600;">NO H2H DATA FOUND</p>'}
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div style="display: flex; justify-content: center; align-items: center; margin-top: 1rem;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; margin-bottom: 0.5rem; font-weight: 700; text-align: center;">Recent Form Trend</div>
                            <div class="mini-chart-wrapper" style="height: 100px; width: 100%; position: relative;">
                                <canvas id="card-chart-recent-${gridId}-${player.object_id}"></canvas>
                            </div>
                        </div>
                    </div>
                    `}
                </div>
            `;

            card.innerHTML += chartBlock;
            grid.appendChild(card);
        
        setTimeout(() => {
            if (type !== 'h2h') {
                drawCardLineGraph(`card-chart-recent-${gridId}-${player.object_id}`, player, themeColor);
            } else if (player.h2hStats && player.h2hStats.length > 0) {
                drawCardLineGraph(`card-chart-h2h-${gridId}-${player.object_id}`, player, '#8b5cf6', true);
            }
        }, 100);
    });
}

function renderAllPlayersDetailedList() {
    const teamNames = matchData.teams;
    const teamAContainer = document.getElementById('team-a-list');
    const teamBContainer = document.getElementById('team-b-list');
    
    document.getElementById('team-a-name').innerText = teamNames[0] || 'Team A';
    document.getElementById('team-b-name').innerText = teamNames[1] || 'Team B';

    teamAContainer.innerHTML = '';
    teamBContainer.innerHTML = '';

    matchData.allPlayers.forEach(player => {
        const opponent = matchData.teams.find(t => t !== player.team) || 'Opponent';
        const container = player.team === teamNames[0] ? teamAContainer : teamBContainer;
        if (!container) return;

        const block = document.createElement('div');
        
        // Simple Decision Logic
        let decisionText = "SKIP";
        let decisionClass = "badge-skip";
        let blockClass = "pick-skip";
        let emoji = "❌";

        if (player.pickScore > 85) {
            decisionText = "MUST PICK";
            decisionClass = "badge-high";
            blockClass = "pick-high";
            emoji = "🔥";
        } else if (player.pickScore > 70) {
            decisionText = "GOOD PICK";
            decisionClass = "badge-mid";
            blockClass = "pick-mid";
            emoji = "✅";
        } else if (player.pickScore > 40) {
            decisionText = "RISKY";
            decisionClass = "badge-low";
            blockClass = "pick-low";
            emoji = "⚠️";
        }

        const isTeamA = player.team === teamNames[0];
        const teamClass = isTeamA ? 'team-a-theme' : 'team-b-theme';
        block.className = `player-detail-block ${blockClass} ${teamClass}`;
        
        const starCount = Math.floor(player.pickScore / 20) + 1;
        const stars = '★'.repeat(Math.min(5, starCount)) + '☆'.repeat(Math.max(0, 5 - starCount));

        let matchGridHtml = '';
        player.stats.forEach(s => {
            let scoreLine = '';
            if (s.bat) scoreLine += `🏏 ${s.bat}`;
            if (s.bowl) scoreLine += (s.bat ? ' | ' : '') + `${STUMP_ICON} ${s.bowl}`;
            matchGridHtml += `<div class="mini-match-item"><div class="mini-opp">vs ${s.opp}</div><div class="mini-score">${scoreLine}</div></div>`;
        });

        let h2hContent = '';
        if (player.h2hStats && player.h2hStats.length > 0) {
            h2hContent = `
                <div class="sparkline-container" style="height: 120px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 1rem 0.5rem; border-radius: 1rem;">
                    <canvas id="h2h-spark-${player.object_id}" class="player-sparkline"></canvas>
                </div>
            `;
        } else {
            h2hContent = '<p style="font-size: 0.9rem; opacity: 0.6; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 1rem;">No recent H2H records found.</p>';
        }

        block.innerHTML = `
            <div class="decision-container">
                <div class="decision-badge ${decisionClass}">
                    <span>${emoji}</span> ${decisionText}
                </div>
                <div class="stars">${stars}</div>
            </div>
            
            <div class="player-header-main">
                <h3 onclick="openPlayerProfile('${player.player_id}', '${player.object_id}', '${player.name.replace(/'/g, "\\'")}', '${player.role.replace(/'/g, "\\'")}', '${opponent.replace(/'/g, "\\'")}')" style="cursor: pointer; color: var(--accent-blue); text-decoration: underline;">${player.name} <span style="font-size: 0.9rem; opacity: 0.7; font-weight: 400;">(${player.role ? player.role.charAt(0).toUpperCase() + player.role.slice(1) : 'Player'})</span></h3>
            </div>

            <div class="sparkline-section">
                <h4 class="sub-title" style="margin-top: 1.5rem; font-size: 0.85rem; letter-spacing: 1px; color: var(--text-secondary); text-transform: uppercase;">Recent Form Trend</h4>
                <div class="sparkline-container" style="height: 140px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 1rem 0.5rem; border-radius: 1rem;">
                    <canvas id="spark-${player.object_id}" class="player-sparkline"></canvas>
                </div>
            </div>

            <div class="stats-grid-wrapper" style="margin-top: 1.5rem;">
                <div class="record-group">
                    <h4 class="sub-title" style="font-size: 0.85rem; letter-spacing: 1px; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">H2H Power</h4>
                    ${h2hContent}
                </div>
            </div>
        `;
        container.appendChild(block);

        // Draw sparklines after they are in the DOM
        setTimeout(() => {
            drawSparkline(`spark-${player.object_id}`, player, isTeamA ? '#3b82f6' : '#f43f5e', false);
            if (player.h2hStats && player.h2hStats.length > 0) {
                drawSparkline(`h2h-spark-${player.object_id}`, player, '#8b5cf6', true); // Purple theme for H2H
            }
        }, 0);
    });
}

const cardCharts = {};

function drawCardLineGraph(canvasId, player, themeColor, isH2H = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const stats = isH2H ? player.h2hStats : player.stats;
    
    if (cardCharts[canvasId]) {
        cardCharts[canvasId].destroy();
    }

    const rawStats = [...stats].reverse();
    // For mini-charts, we only want the most recent 6 matches to keep it clean and readable
    const limitedStats = rawStats.slice(-6);
    
    const data = limitedStats.map(s => {
        let runs = parseInt(s.bat?.replace('*','')) || 0;
        let wkts = parseInt(s.bowl) || 0;
        return runs + (wkts * 30); 
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, themeColor + '80'); // 50% opacity
    gradient.addColorStop(1, 'transparent');

    cardCharts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: limitedStats.map(s => s.date),
            datasets: [{
                data: data,
                borderColor: themeColor,
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: themeColor,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: {
                duration: 2000,
                easing: 'easeOutQuart'
            },
            hover: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: { display: false },
                y: { display: false, suggestedMax: Math.max(...data, 20) + 25 }
            },
            layout: { padding: { top: 25, left: 12, right: 12, bottom: 5 } }
        },
        plugins: [{
            id: 'alwaysOnLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((point, index) => {
                        const val = dataset.data[index];
                        
                        // Parse original run/wkt for text
                        let stat = limitedStats[index];
                        let r = parseInt(stat.bat?.replace('*','')) || 0;
                        let w = parseInt(stat.bowl) || 0;
                        let text = r > 0 ? r : '';
                        if (w > 0) text += (text ? '+' : '') + w + 'W';
                        if (!text) text = '0';

                        ctx.font = 'bold 11px Outfit';
                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.shadowColor = 'rgba(0,0,0,1)';
                        ctx.shadowBlur = 4;
                        ctx.fillText(text, point.x, point.y - 6);
                        ctx.shadowBlur = 0;
                    });
                });
                ctx.restore();
            }
        }]
    });
}

let sparklineCharts = {};

function drawSparkline(canvasId, player, themeColor = '#3b82f6', isH2H = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const stats = isH2H ? player.h2hStats : player.stats;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    if (sparklineCharts[canvasId]) {
        sparklineCharts[canvasId].destroy();
    }

    const reversedStats = [...stats].reverse();
    // Same logic as card graph: runs + (wkts * 20) for the trendline shape
    const data = reversedStats.map(s => {
        let runs = parseInt(s.bat?.replace('*','')) || 0;
        let wkts = parseInt(s.bowl) || 0;
        return runs + (wkts * 30);
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 80);
    gradient.addColorStop(0, themeColor + '80');
    gradient.addColorStop(1, 'transparent');

    sparklineCharts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: reversedStats.map(s => isH2H ? s.date.split(',')[0].slice(0, 6) : s.opp.slice(0, 3).toUpperCase()),
            datasets: [{
                data: data,
                borderColor: themeColor,
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: themeColor,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: {
                duration: 2500,
                easing: 'easeOutElastic',
                delay: (context) => context.dataIndex * 100
            },
            scales: {
                x: { 
                    display: true, 
                    grid: { display: false, drawBorder: false }, 
                    ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 9, family: 'Outfit' }, maxRotation: 45, minRotation: 45 } 
                },
                y: { display: false, suggestedMax: Math.max(...data, 20) + 20 }
            },
            layout: { padding: { top: 18, left: 15, right: 15, bottom: 0 } }
        },
        plugins: [{
            id: 'alwaysOnLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((point, index) => {
                        let stat = reversedStats[index];
                        let r = parseInt(stat.bat?.replace('*','')) || 0;
                        let w = parseInt(stat.bowl) || 0;
                        let text = r > 0 ? r : '';
                        if (w > 0) text += (text ? '+' : '') + w + 'W';
                        if (!text) text = '0';

                        ctx.font = 'bold 11px Outfit';
                        ctx.fillStyle = '#ffffff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.shadowColor = 'rgba(0,0,0,1)';
                        ctx.shadowBlur = 4;
                        ctx.fillText(text, point.x, point.y - 6);
                        ctx.shadowBlur = 0;
                    });
                });
                ctx.restore();
            }
        }]
    });
}

function renderComparisonChart() {
    const ctx = document.getElementById('teamComparisonChart').getContext('2d');
    if (comparisonChart) comparisonChart.destroy();

    const sortedPlayers = [...matchData.allPlayers].sort((a, b) => b.pickScore - a.pickScore);
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    comparisonChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedPlayers.map(p => p.name),
            datasets: [{
                label: 'Historical Impact Score',
                data: sortedPlayers.map(p => p.pickScore),
                borderColor: '#3b82f6',
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: sortedPlayers.map(p => p.pickScore > 85 ? '#10b981' : p.pickScore > 70 ? '#3b82f6' : '#8b5cf6'),
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8,
                fill: true,
                tension: 0.5
            }]
        },
        options: {
            onClick: (event, activeElements) => {
                if (activeElements && activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const player = sortedPlayers[index];
                    if (player) {
                        const opponent = matchData.teams.find(t => t !== player.team);
                        const url = `player.html?pid=${player.player_id}&objectId=${player.object_id}&name=${encodeURIComponent(player.name)}&role=${encodeURIComponent(player.role)}&opponent=${encodeURIComponent(opponent)}&ground=${encodeURIComponent(matchData.ground || '')}`;
                        window.open(url, '_blank');
                    }
                }
            },
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11, family: 'Outfit' }, maxRotation: 45, minRotation: 45 } },
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Outfit' } } }
            },
            plugins: {
                tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', titleFont: { family: 'Outfit', size: 14 }, bodyFont: { family: 'Outfit', size: 13 }, padding: 12, cornerRadius: 8 }
            },
            animation: {
                duration: 2000,
                easing: 'easeInOutQuart'
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

function selectPlayer(player, element) {
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
    element.classList.add('active');
}




window.selectPlayerById = function(objectId) {
    const player = matchData.allPlayers.find(p => p.object_id == objectId);
    if (player) {
        // Open in new tab
        const opponent = matchData.teams.find(t => t !== player.team);
        const url = `player.html?pid=${player.player_id}&objectId=${player.object_id}&name=${encodeURIComponent(player.name)}&role=${encodeURIComponent(player.role)}&opponent=${encodeURIComponent(opponent)}`;
        window.open(url, '_blank');
        
        // Highlight in grids
        document.querySelectorAll('.player-card').forEach(c => {
            if (c.onclick && c.onclick.toString().includes(objectId)) {
                document.querySelectorAll('.player-card').forEach(pc => pc.classList.remove('active'));
                c.classList.add('active');
            }
        });
    }
}



window.openPlayerProfile = function(pid, objectId, name, role, opponent) {
    const url = `player.html?pid=${pid}&objectId=${objectId}&name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&opponent=${encodeURIComponent(opponent)}`;
    window.open(url, '_blank');
};

window.bulkOpenPlayers = function(teamIndex) {
    if (!matchData || !matchData.allPlayers) {
        alert("Neural Dataset not yet loaded. Please wait for uplink.");
        return;
    }
    
    const teamName = matchData.teams[teamIndex];
    const players = matchData.allPlayers.filter(p => p.team === teamName);
    const opponent = matchData.teams.find(t => t !== teamName);
    
    if (players.length === 0) {
        alert(`No players found for ${teamName}. Check connectivity.`);
        return;
    }

    console.log(`Initiating Light-Speed Sweep for ${teamName}...`);
    
    players.forEach((p, i) => {
        const url = `player.html?pid=${p.player_id}&objectId=${p.object_id}&name=${encodeURIComponent(p.name)}&role=${encodeURIComponent(p.role)}&opponent=${encodeURIComponent(opponent)}`;
        
        // Rapid fire opening
        setTimeout(() => {
            window.open(url, '_blank');
        }, i * 50); // 50ms is effectively "light speed" but stable
    });
};

window.init = init;
init();
