// GLOBAL STATE
let currentUser = null;
let currentGame = null;
let currentGameId = null;
let isHost = false;
let gameListener = null;
let timerInterval = null;

const AVATARS = ['👨', '👩', '👦', '👧', '🧔', '👴', '👵', '👱‍♂️', '👱‍♀️', '🧑'];
const BOT_NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank'];
const TOTAL_ROUNDS = 5;

// UTILITY FUNCTIONS
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showLoading(show = true) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function getRandomAvatar() {
    return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

function getRandomBotName() {
    const used = Object.values(currentGame?.players || {}).map(p => p.name);
    const available = BOT_NAMES.filter(n => !used.includes(n));
    return available[Math.floor(Math.random() * available.length)] || 'Bot';
}

// AUTH
auth.signInAnonymously().then(user => {
    currentUser = user.user;
}).catch(err => {
    showToast('Authentication failed: ' + err.message);
});

// LOBBY FUNCTIONS
function showJoinScreen() {
    document.getElementById('joinScreen').classList.remove('hidden');
}

async function createLobby() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) {
        showToast('Please enter your name');
        return;
    }

    showLoading();
    const code = generateCode();
    const gameRef = db.ref('games').push();
    currentGameId = gameRef.key;

    const gameData = {
        code,
        hostUid: currentUser.uid,
        state: 'lobby',
        round: 1,
        totalRounds: TOTAL_ROUNDS,
        players: {
            [currentUser.uid]: {
                uid: currentUser.uid,
                name,
                avatar: getRandomAvatar(),
                isBot: false,
                alive: true,
                points: 0
            }
        },
        createdAt: Date.now()
    };

    await gameRef.set(gameData);
    isHost = true;
    listenToGame(currentGameId);
    showScreen('lobbyScreen');
    showLoading(false);
}

async function joinLobby() {
    const name = document.getElementById('playerName').value.trim();
    const code = document.getElementById('joinCode').value.trim();
    
    if (!name || !code) {
        showToast('Please enter name and code');
        return;
    }

    showLoading();
    
    // Find game by code
    const snapshot = await db.ref('games').orderByChild('code').equalTo(code).once('value');
    const games = snapshot.val();
    
    if (!games) {
        showToast('Game not found');
        showLoading(false);
        return;
    }

    currentGameId = Object.keys(games)[0];
    const game = games[currentGameId];

    // Check if game is full
    const playerCount = Object.keys(game.players || {}).length;
    if (playerCount >= 20) {
        showToast('Game is full');
        showLoading(false);
        return;
    }

    // Add player
    await db.ref(`games/${currentGameId}/players/${currentUser.uid}`).set({
        uid: currentUser.uid,
        name,
        avatar: getRandomAvatar(),
        isBot: false,
        alive: true,
        points: game.players[currentUser.uid]?.points || 0
    });

    isHost = false;
    listenToGame(currentGameId);
    showScreen('lobbyScreen');
    showLoading(false);
}

function listenToGame(gameId) {
    if (gameListener) gameListener.off();
    
    gameListener = db.ref(`games/${gameId}`);
    gameListener.on('value', snapshot => {
        currentGame = snapshot.val();
        if (!currentGame) {
            showToast('Game ended');
            returnToLobby();
            return;
        }
        
        updateUI();
    });
}

function updateUI() {
    if (!currentGame) return;

    // Update lobby code
    document.getElementById('lobbyCode').textContent = currentGame.code;
    
    // Update round counters
    document.querySelectorAll('#currentRound, #gameRound').forEach(el => {
        el.textContent = currentGame.round || 1;
    });

    // Update players grid
    const playersGrid = document.getElementById('playersGrid');
    playersGrid.innerHTML = '';
    
    Object.values(currentGame.players || {}).forEach(player => {
        const card = document.createElement('div');
        card.className = `player-card ${player.uid === currentGame.hostUid ? 'host' : ''} ${player.isBot ? 'bot' : ''} ${!player.alive ? 'dead' : ''}`;
        card.innerHTML = `
            <div class="avatar">${player.avatar}</div>
            <div class="name">${player.name}</div>
            <div class="status">${player.alive ? '💚 Alive' : '💀 Dead'}</div>
        `;
        playersGrid.appendChild(card);
    });

    // Show/hide host controls
    if (currentGame.hostUid === currentUser.uid) {
        document.getElementById('hostControls').classList.remove('hidden');
    }

    // Handle game state changes
    if (currentGame.state === 'night' || currentGame.state === 'day') {
        showScreen('gameScreen');
        updateGameScreen();
    } else if (currentGame.state === 'results') {
        showScreen('resultsScreen');
        updateResultsScreen();
    }
}

async function addBot() {
    const playerCount = Object.keys(currentGame.players).length;
    if (playerCount >= 20) {
        showToast('Maximum players reached');
        return;
    }

    const botId = 'bot_' + Date.now();
    await db.ref(`games/${currentGameId}/players/${botId}`).set({
        uid: botId,
        name: getRandomBotName(),
        avatar: '🤖',
        isBot: true,
        alive: true,
        points: 0
    });
}

async function startGame() {
    const playerCount = Object.keys(currentGame.players).length;
    if (playerCount < 1) {
        showToast('Need at least 1 player');
        return;
    }

    showLoading();
    
    // Assign roles
    const players = Object.values(currentGame.players);
    const mafiaCount = Math.max(1, Math.floor(playerCount / 5));
    const roles = [];
    
    // Add special roles
    for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
    if (playerCount >= 5) roles.push('detective');
    if (playerCount >= 6) roles.push('doctor');
    
    // Fill with villagers
    while (roles.length < playerCount) roles.push('villager');
    
    // Shuffle
    roles.sort(() => Math.random() - 0.5);
    
    // Assign
    const updates = {};
    players.forEach((player, idx) => {
        updates[`players/${player.uid}/role`] = roles[idx];
        updates[`players/${player.uid}/alive`] = true;
    });
    
    updates['state'] = 'night';
    updates['phaseStartTime'] = Date.now();
    updates['phaseDuration'] = 45000; // 45 seconds
    updates['actions'] = {};
    updates['votes'] = {};
    updates['events'] = [];
    
    await db.ref(`games/${currentGameId}`).update(updates);
    
    // Start bot AI
    setTimeout(() => runBotAI(), 2000);
    
    showLoading(false);
}

function leaveLobby() {
    if (gameListener) gameListener.off();
    if (currentGameId && currentUser) {
        db.ref(`games/${currentGameId}/players/${currentUser.uid}`).remove();
    }
    currentGameId = null;
    currentGame = null;
    isHost = false;
    showScreen('landingScreen');
}

function copyCode() {
    navigator.clipboard.writeText(currentGame.code);
    showToast('Code copied: ' + currentGame.code);
}

// GAME SCREEN
function updateGameScreen() {
    const player = currentGame.players[currentUser.uid];
    if (!player) return;

    // Update phase
    const isNight = currentGame.state === 'night';
    document.getElementById('phaseIcon').textContent = isNight ? '🌙' : '☀️';
    document.getElementById('phaseText').textContent = isNight ? 'NIGHT' : 'DAY';

    // Update role
    const roleMap = {
        mafia: { name: '🔪 Mafia', desc: 'Eliminate villagers', class: 'mafia' },
        doctor: { name: '💉 Doctor', desc: 'Save someone from death', class: 'doctor' },
        detective: { name: '🔍 Detective', desc: 'Investigate players', class: 'detective' },
        villager: { name: '👨‍🌾 Villager', desc: 'Find the Mafia!', class: 'villager' }
    };
    
    const roleInfo = roleMap[player.role] || roleMap.villager;
    document.getElementById('roleName').textContent = roleInfo.name;
    document.getElementById('roleName').className = `role-name ${roleInfo.class}`;
    document.getElementById('roleDesc').textContent = roleInfo.desc;

    // Update timer
    updateTimer();

    // Update actions
    updateActions(player);

    // Update game log
    updateGameLog();

    // Update alive players
    updateAlivePlayers();
}

function updateTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - currentGame.phaseStartTime;
        const remaining = Math.max(0, currentGame.phaseDuration - elapsed);
        
        const seconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        
        const timerEl = document.getElementById('timer');
        timerEl.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        
        if (seconds <= 10) {
            timerEl.classList.add('urgent');
        } else {
            timerEl.classList.remove('urgent');
        }
        
        if (remaining === 0 && isHost) {
            clearInterval(timerInterval);
            resolvePhase();
        }
    }, 100);
}

function updateActions(player) {
    const actionArea = document.getElementById('actionArea');
    const actionTitle = document.getElementById('actionTitle');
    const actionButtons = document.getElementById('actionButtons');
    
    if (!player.alive) {
        actionArea.innerHTML = '<p style="text-align:center;color:#999;">You are dead. Watch the game unfold...</p>';
        return;
    }

    const isNight = currentGame.state === 'night';
    const hasActed = isNight ? 
        currentGame.actions?.[currentUser.uid] : 
        currentGame.votes?.[currentUser.uid];

    if (hasActed) {
        actionTitle.textContent = '✅ Action Submitted';
        actionButtons.innerHTML = '<p style="text-align:center;color:#666;">Waiting for others...</p>';
        return;
    }

    const alivePlayers = Object.values(currentGame.players).filter(p => 
        p.alive && p.uid !== currentUser.uid
    );

    if (isNight) {
        // Night actions
        if (player.role === 'mafia') {
            actionTitle.textContent = '🔪 Choose target to eliminate';
        } else if (player.role === 'doctor') {
            actionTitle.textContent = '💉 Choose someone to save';
            alivePlayers.push(player); // Doctor can save self
        } else if (player.role === 'detective') {
            actionTitle.textContent = '🔍 Investigate a player';
        } else {
            actionArea.innerHTML = '<p style="text-align:center;color:#666;">Sleep tight... waiting for morning.</p>';
            return;
        }
    } else {
        // Day voting
        actionTitle.textContent = '⚖️ Vote to eliminate';
    }

    actionButtons.innerHTML = '';
    alivePlayers.forEach(p => {
        const btn = document.createElement('div');
        btn.className = 'action-btn';
        btn.innerHTML = `
            <div class="avatar">${p.avatar}</div>
            <div class="name">${p.name}</div>
        `;
        btn.onclick = () => submitAction(p.uid);
        actionButtons.appendChild(btn);
    });
}

async function submitAction(targetUid) {
    const player = currentGame.players[currentUser.uid];
    const isNight = currentGame.state === 'night';
    
    if (isNight) {
        await db.ref(`games/${currentGameId}/actions/${currentUser.uid}`).set({
            role: player.role,
            target: targetUid,
            timestamp: Date.now()
        });
    } else {
        await db.ref(`games/${currentGameId}/votes/${currentUser.uid}`).set(targetUid);
    }
    
    showToast('Action submitted!');
    
    // Update UI immediately
    updateActions(player);
}

function updateGameLog() {
    const logEl = document.getElementById('gameLog');
    const events = currentGame.events || [];
    
    logEl.innerHTML = events.slice(-5).reverse().map(e => 
        `<div class="log-entry ${e.type}">${e.message}</div>`
    ).join('');
    
    logEl.scrollTop = logEl.scrollHeight;
}

function updateAlivePlayers() {
    const container = document.getElementById('alivePlayers');
    const alive = Object.values(currentGame.players).filter(p => p.alive);
    
    container.innerHTML = `
        <h4>👥 Alive Players (${alive.length})</h4>
        <div class="players-list">
            ${alive.map(p => `<div class="player-tag">${p.avatar} ${p.name}</div>`).join('')}
        </div>
    `;
}

// PHASE RESOLUTION
async function resolvePhase() {
    if (!isHost) return;
    
    const isNight = currentGame.state === 'night';
    
    if (isNight) {
        await resolveNight();
    } else {
        await resolveDay();
    }
}

async function resolveNight() {
    const actions = currentGame.actions || {};
    const events = currentGame.events || [];
    
    // Get mafia target (most voted)
    const mafiaActions = Object.values(actions).filter(a => a.role === 'mafia');
    const mafiaVotes = {};
    mafiaActions.forEach(a => {
        mafiaVotes[a.target] = (mafiaVotes[a.target] || 0) + 1;
    });
    
    let mafiaTarget = null;
    let maxVotes = 0;
    Object.entries(mafiaVotes).forEach(([target, votes]) => {
        if (votes > maxVotes) {
            maxVotes = votes;
            mafiaTarget = target;
        }
    });
    
    // Get doctor save
    const doctorAction = Object.values(actions).find(a => a.role === 'doctor');
    const doctorTarget = doctorAction?.target;
    
    // Get detective check
    const detectiveAction = Object.values(actions).find(a => a.role === 'detective');
    const detectiveTarget = detectiveAction?.target;
    
    const updates = {};
    
    // Process death/save
    if (mafiaTarget) {
        if (mafiaTarget === doctorTarget) {
            events.push({
                type: 'save',
                message: `💉 Someone was saved by the Doctor!`,
                timestamp: Date.now()
            });
        } else {
            const victim = currentGame.players[mafiaTarget];
            updates[`players/${mafiaTarget}/alive`] = false;
            events.push({
                type: 'death',
                message: `💀 ${victim.name} was eliminated by the Mafia!`,
                timestamp: Date.now()
            });
        }
    } else {
        events.push({
            type: 'info',
            message: `🌙 The night was quiet...`,
            timestamp: Date.now()
        });
    }
    
    // Detective result (private - simplified: add to events for now)
    if (detectiveTarget && detectiveAction) {
        const isMafia = currentGame.players[detectiveTarget]?.role === 'mafia';
        const targetName = currentGame.players[detectiveTarget]?.name;
        events.push({
            type: 'info',
            message: `🔍 Detective checked ${targetName}: ${isMafia ? '🔴 MAFIA!' : '🟢 Innocent'}`,
            timestamp: Date.now()
        });
    }
    
    updates['events'] = events;
    updates['actions'] = {};
    updates['state'] = 'day';
    updates['phaseStartTime'] = Date.now();
    updates['phaseDuration'] = 60000; // 60 seconds for day
    
    await db.ref(`games/${currentGameId}`).update(updates);
    
    // Check win condition
    setTimeout(() => checkWinCondition(), 1000);
    
    // Run bot AI for day phase
    setTimeout(() => runBotAI(), 3000);
}

async function resolveDay() {
    const votes = currentGame.votes || {};
    const events = currentGame.events || [];
    
    // Tally votes
    const voteCounts = {};
    Object.values(votes).forEach(target => {
        voteCounts[target] = (voteCounts[target] || 0) + 1;
    });
    
    // Find most voted
    let eliminated = null;
    let maxVotes = 0;
    Object.entries(voteCounts).forEach(([target, count]) => {
        if (count > maxVotes) {
            maxVotes = count;
            eliminated = target;
        }
    });
    
    const updates = {};
    
    if (eliminated && maxVotes > 0) {
        const victim = currentGame.players[eliminated];
        updates[`players/${eliminated}/alive`] = false;
        events.push({
            type: 'death',
            message: `⚖️ ${victim.name} (${victim.role}) was voted out!`,
            timestamp: Date.now()
        });
    } else {
        events.push({
            type: 'info',
            message: `⚖️ No one was eliminated. (No votes or tie)`,
            timestamp: Date.now()
        });
    }
    
    updates['events'] = events;
    updates['votes'] = {};
    updates['state'] = 'night';
    updates['phaseStartTime'] = Date.now();
    updates['phaseDuration'] = 45000;
    
    await db.ref(`games/${currentGameId}`).update(updates);
    
    // Check win condition
    setTimeout(() => checkWinCondition(), 1000);
    
    // Run bot AI for night
    setTimeout(() => runBotAI(), 2000);
}

async function checkWinCondition() {
    if (!isHost) return;
    
    const players = Object.values(currentGame.players);
    const alivePlayers = players.filter(p => p.alive);
    const aliveMafia = alivePlayers.filter(p => p.role === 'mafia');
    const aliveVillagers = alivePlayers.filter(p => p.role !== 'mafia');
    
    let winner = null;
    
    if (aliveMafia.length === 0) {
        winner = 'villagers';
    } else if (aliveMafia.length >= aliveVillagers.length) {
        winner = 'mafia';
    }
    
    if (winner) {
        // Award points
        const updates = {};
        
        if (winner === 'villagers') {
            aliveVillagers.forEach(p => {
                updates[`players/${p.uid}/points`] = (p.points || 0) + 10;
            });
            // Dead villagers get partial points
            players.filter(p => !p.alive && p.role !== 'mafia').forEach(p => {
                updates[`players/${p.uid}/points`] = (p.points || 0) + 5;
            });
        } else {
            aliveMafia.forEach(p => {
                updates[`players/${p.uid}/points`] = (p.points || 0) + 15;
            });
        }
        
        updates['winner'] = winner;
        updates['state'] = 'results';
        
        await db.ref(`games/${currentGameId}`).update(updates);
    }
}

// RESULTS SCREEN
function updateResultsScreen() {
    const winnerText = document.getElementById('winnerText');
    const scoreboard = document.getElementById('scoreboard');
    
    if (currentGame.winner === 'villagers') {
        winnerText.textContent = '🎉 VILLAGERS WIN!';
    } else {
        winnerText.textContent = '🔪 MAFIA WINS!';
    }
    
    // Sort by points
    const sorted = Object.values(currentGame.players).sort((a, b) => (b.points || 0) - (a.points || 0));
    
    const medals = ['🥇', '🥈', '🥉'];
    scoreboard.innerHTML = sorted.map((p, idx) => `
        <div class="score-item">
            <div class="rank">${medals[idx] || (idx + 1)}</div>
            <div class="player-info">
                <div class="player-name">${p.avatar} ${p.name}</div>
                <div class="player-role">${p.role} ${p.alive ? '💚' : '💀'}</div>
            </div>
            <div class="points">${p.points || 0} pts</div>
        </div>
    `).join('');
    
    // Show/hide next round button
    const nextBtn = document.getElementById('nextRoundBtn');
    if (currentGame.round >= TOTAL_ROUNDS) {
        nextBtn.style.display = 'none';
    } else {
      
