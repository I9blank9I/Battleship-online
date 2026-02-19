// 1. Import Firebase from the CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// 2. Your Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAFThGhTv6x-h-_AM3CUA2KtU-O6MxH2DA",
    authDomain: "battleship-game-e61db.firebaseapp.com",
    databaseURL: "https://battleship-game-e61db-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "battleship-game-e61db",
    storageBucket: "battleship-game-e61db.firebasestorage.app",
    messagingSenderId: "124197856470",
    appId: "1:124197856470:web:f56ef157f0a86345171577"
};

// 3. Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- GLOBAL VARIABLES ---
let gameCode = "";
let playerRole = ""; 
let myShips = []; 
let isMyTurn = false;
// --- NEW GAME MODE ---
let gameMode = 'normal'; // 'normal' or 'fantasy'
let playerFaction = ''; // 'military', 'mages', 'vikings'
let playerEnergy = 0;
const skillCosts = { attack: 3, utility: 2, ultimate: 9 };
let activeSkill = null;
let previousTurn = null; // Moved to top for proper initialization
let vikingUltMode = 'rows_and_cols';
let lastUAVReportHTML = ''; // For persistent UAV panel
let gameState = {}; // Cache the latest game state

// Placement State
let isPlacementPhase = false;
let shipsToPlace = [5, 4, 3, 3, 2]; 
let currentShipLength = 0;
let currentShipOrientation = 'horizontal'; 
let placedShips = [];
let placedShipObjects = []; 
let playerReady = false; 
let opponentReady = false; 

const totalShipCells = 17; 

// Offline State
let isOfflineMode = false;
let opponentShips = []; 
let robotShips = []; // DEPRECATED in favor of gameState
let robotShipObjects = [];
let robotShots = []; 
let robotState = 'searching'; // 'searching' or 'hunting'
let robotHuntQueue = [];
// NEW: Add state for smarter hunting
let robotHuntInfo = { firstHit: null, orientation: null, knownHits: [] };

// NEW: Helper to reset the hunt state
function resetRobotHunt() {
    robotState = 'searching';
    robotHuntQueue = [];
    robotHuntInfo = { firstHit: null, orientation: null, knownHits: [] };
}

// --- HELPER: GENERATE ROBOT SHIPS ---
function generateShipsForRobot() {
    const robotBoard = [];
    const robotShipObjects = [];
    const shipsToGenerate = [5, 4, 3, 3, 2];

    for (const length of shipsToGenerate) {
        let placed = false;
        while (!placed) {
            const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
            const startIndex = Math.floor(Math.random() * 100);
            const shipCells = getShipCells(startIndex, length, orientation);

            const isValid = (cells) => {
                if (!cells) return false;
                return cells.every(cell => !robotBoard.includes(cell));
            };

            if (isValid(shipCells)) {
                robotBoard.push(...shipCells);
                robotShipObjects.push({ length: length, indices: shipCells });
                placed = true;
            }
        }
    }
    return { board: robotBoard, shipObjects: robotShipObjects };
}

// --- HELPER: GENERATE PLAYER SHIP OBJECTS (for randomize and remove feature) ---
function generateShipObjects() {
    const shipObjects = [];
    const allPlacedIndices = [];
    const shipsToGenerate = [5, 4, 3, 3, 2];

    const isValidForGeneration = (cells) => {
        if (!cells) return false;
        return cells.every(cell => !allPlacedIndices.includes(cell));
    };

    for (const length of shipsToGenerate) {
        let placed = false;
        while (!placed) {
            const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
            const startIndex = Math.floor(Math.random() * 100);
            const shipCells = getShipCells(startIndex, length, orientation);

            if (isValidForGeneration(shipCells)) {
                shipObjects.push({ length: length, indices: shipCells });
                allPlacedIndices.push(...shipCells);
                placed = true;
            }
        }
    }
    return shipObjects;
}

// --- HELPER: CHECK IF A SHIP CAN BE PLACED (for AI) ---
function isPlacementPossible(startIndex, length, orientation, occupiedTiles) {
    const shipCells = getShipCells(startIndex, length, orientation); // This already checks boundaries
    if (!shipCells) return false;
    // Check if any of the required cells have already been shot at
    return shipCells.every(cell => !occupiedTiles.includes(cell));
}
window.randomizePlayerShips = () => {
    // 1. Reset everything
    placedShips = [];
    placedShipObjects = [];
    shipsToPlace = []; // We assume random fills ALL ships
    
    // 2. Use helper to get ship objects and flatten for the main array
    placedShipObjects = generateShipObjects();
    placedShips = placedShipObjects.flatMap(obj => obj.indices);
    
    // 3. Update UI
    document.getElementById('placement-message').innerText = "Ships randomized! Click a ship to remove it.";
    document.getElementById('finish-placement-btn').disabled = false;
    renderPlacementBoard();
    renderShipSelection(); // To show all buttons as 'placed'
};

window.selectGameMode = (mode) => {
    gameMode = mode;
    document.getElementById('mode-selection-panel').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    if (mode === 'fantasy') {
        document.getElementById('status-msg').innerText = "Mode: Fantasy";
    }
};

// --- UI FUNCTIONS ---

function triggerScreenShake() {
    const arena = document.getElementById('game-arena');
    arena.classList.add('screen-shake-effect');
    setTimeout(() => {
        arena.classList.remove('screen-shake-effect');
    }, 500); // Duration of the animation in style.css
}

// 1. Create Game
window.createGame = () => {
    gameCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    playerRole = 'host';
    console.log("Game Created:", gameCode, "Mode:", gameMode);
    
    set(ref(db, 'games/' + gameCode), {
        gameMode: gameMode,
        status: 'waiting',
        roundCount: 0,
        turn: 'host',
        host: {
            board: [],
            shipObjects: [],
            hits: [],
            misses: [],
            ready: false,
            faction: '',
            uavActive: false,
            riftCooldown: 0,
            energy: 0,
        }, // No consecutiveMisses needed anymore
        guest: {
            board: [],
            shipObjects: [],
            hits: [],
            misses: [],
            ready: false,
            faction: '',
            uavActive: false,
            riftCooldown: 0,
            energy: 0,
        },
    });

    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('placement-panel').classList.remove('hidden');
    document.getElementById('placement-game-code').innerText = gameCode;
    document.getElementById('status-msg').innerText = "Status: Connected (Host)";
    
    startPlacementPhase();
};

// 2. Join Game
window.joinGame = () => {
    gameCode = document.getElementById('join-input').value.toUpperCase();
    playerRole = 'guest';
    console.log("Attempting to join game:", gameCode);

    // Fetch game mode first to set up the UI correctly for the guest
    onValue(ref(db, `games/${gameCode}`), (snapshot) => {
        const gameData = snapshot.val();
        if (!gameData) {
            alert("Game not found!");
            return;
        }
        gameMode = gameData.gameMode || 'normal';
        if (gameMode === 'fantasy') {
            document.getElementById('status-msg').innerText = "Mode: Fantasy";
        }

        update(ref(db, 'games/' + gameCode), { status: 'active' });

        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('placement-panel').classList.remove('hidden');
        document.getElementById('placement-game-code').innerText = gameCode;
        document.getElementById('status-msg').innerText = `Status: Connected (Guest)`;
        startPlacementPhase();

    }, { onlyOnce: true });
};

// 3. Start Offline Game
window.startOfflineGame = () => {
    isOfflineMode = true;
    playerRole = 'host';
    // Robot ships are now generated later in startGameUI

    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('placement-panel').classList.remove('hidden');
    document.getElementById('placement-game-code').innerText = "OFFLINE";
    document.getElementById('status-msg').innerText = "Status: Offline Mode";

    startPlacementPhase();
};

// 4. Developer Secret Command
(() => {
    const secret = 'admin99';
    window.revealEnemy = (password) => {    // Usage: revealEnemy('admin99')
        if (password === secret) { 
            console.log("Enemy Ships:", opponentShips);
            const enemyBoard = document.getElementById('enemy-board');
            opponentShips.forEach(index => {
                if (enemyBoard.children[index]) enemyBoard.children[index].classList.add('ship');
            });
        } else {
            console.log("Access Denied: Wrong Password");
        }
    };
})();

// --- SHIP PLACEMENT ---
function startPlacementPhase() {
    isPlacementPhase = true;
    placedShips = [];
    shipsToPlace = [5, 4, 3, 3, 2];
    currentShipLength = 0;
    playerReady = false;
    opponentReady = false;

    document.getElementById('finish-placement-btn').disabled = true;
    document.getElementById('waiting-for-opponent').classList.add('hidden');
    
    renderPlacementBoard();
    renderShipSelection();

    if (gameMode === 'fantasy') {
        document.getElementById('faction-selection-container').classList.remove('hidden');
        document.getElementById('placement-message').innerText = "Choose your faction and place your ships.";
        selectFaction('military'); // Set default faction
    } else {
        document.getElementById('faction-selection-container').classList.add('hidden');
        document.getElementById('placement-message').innerText = "Select a ship and click on your board to place it.";
    }
}

function renderPlacementBoard() {
    const board = document.getElementById('my-placement-board');
    board.innerHTML = '';
    for (let i = 0; i < 100; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.classList.add('placement-cell'); // Add a specific class for placement board cells
        cell.dataset.index = i;
        if (placedShips.includes(i)) cell.classList.add('ship');
        
        cell.onclick = () => handlePlacementClick(i);
        cell.onmouseover = () => previewPlacement(i, true);
        cell.onmouseout = () => previewPlacement(i, false);
        board.appendChild(cell);
    }
}

function renderShipSelection() {
    const shipSelectionDiv = document.getElementById('ship-selection');
    shipSelectionDiv.innerHTML = '';
    const shipNames = { 5: "Carrier", 4: "Battleship", 3: "Cruiser", 2: "Destroyer" };

    [5, 4, 3, 3, 2].forEach(length => {
        const button = document.createElement('button');
        button.classList.add('ship-button');
        button.dataset.length = length;
        button.innerText = `${shipNames[length]} (${length})`;
        
        // Check how many of this type are left to place
        const countInArray = shipsToPlace.filter(x => x === length).length;
        const countOriginal = [5, 4, 3, 3, 2].filter(x => x === length).length;
        
        // Disable if we have placed all instances of this ship type
        // (Simple logic: if shipsToPlace doesn't contain it, it's gone)
        if (!shipsToPlace.includes(length)) {
            button.classList.add('placed');
            button.disabled = true;
        }
        
        button.onclick = () => selectShip(length);
        shipSelectionDiv.appendChild(button);
    });
}

window.selectShip = (length) => {
    currentShipLength = length;
    document.querySelectorAll('.ship-button').forEach(btn => btn.classList.remove('selected'));
    
    // Highlight the button
    const btns = document.querySelectorAll('.ship-button');
    for(let btn of btns) {
        if(parseInt(btn.dataset.length) === length && !btn.disabled) {
            btn.classList.add('selected');
            break; 
        }
    }
    document.getElementById('placement-message').innerText = `Placing ${length}-unit ship...`;
};

window.rotateShip = () => {
    currentShipOrientation = (currentShipOrientation === 'horizontal') ? 'vertical' : 'horizontal';
    document.getElementById('orientation-display').innerText = currentShipOrientation;
};

window.selectFaction = (faction) => {
    if (!isPlacementPhase) return;
    playerFaction = faction;

    // Highlight selected button
    document.querySelectorAll('#faction-selection-container button').forEach(btn => {
        if (btn.dataset.faction === faction) {
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-secondary');
        } else {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    });
};

function getShipCells(startIndex, length, orientation) {
    const cells = [];
    for (let i = 0; i < length; i++) {
        let cellIndex = startIndex;
        if (orientation === 'horizontal') {
            if (Math.floor((startIndex + i) / 10) !== Math.floor(startIndex / 10)) return null; // Wrap error
            cellIndex += i;
        } else { 
            if ((startIndex + (i * 10)) >= 100) return null; // Bottom error
            cellIndex += (i * 10);
        }
        cells.push(cellIndex);
    }
    return cells;
}

function isValidPlacement(shipCells) {
    if (!shipCells) return false; 
    return shipCells.every(cell => !placedShips.includes(cell)); 
}

function handlePlacementClick(index) {
    // CASE 1: Removing a ship (Lifting)
    if (placedShips.includes(index)) {
        // Find which ship object this index belongs to
        const shipObj = placedShipObjects.find(obj => obj.indices.includes(index));
        if (!shipObj) return;

        // 1. Remove indices from the master list
        placedShips = placedShips.filter(i => !shipObj.indices.includes(i));
        
        // 2. Remove the object from our tracker
        placedShipObjects = placedShipObjects.filter(obj => obj !== shipObj);
        
        // 3. Add the ship length back to the "to be placed" list
        shipsToPlace.push(shipObj.length);
        
        // 4. Re-render the ship selection buttons to reflect the change
        renderShipSelection();

        // 5. Reset UI
        document.getElementById('finish-placement-btn').disabled = true;
        renderPlacementBoard();
        document.getElementById('placement-message').innerText = "Ship removed. Place it again.";
        return; // Stop here, don't try to place a new ship
    }

    // CASE 2: Placing a ship (Existing Logic with one addition)
    if (!isPlacementPhase || currentShipLength === 0) return;

    const shipCells = getShipCells(index, currentShipLength, currentShipOrientation);

    if (isValidPlacement(shipCells)) {
        placedShips.push(...shipCells);

        // ** NEW: Track the specific ship object **
        placedShipObjects.push({
            length: currentShipLength,
            indices: shipCells
        });
        
        const idx = shipsToPlace.indexOf(currentShipLength);
        if (idx > -1) shipsToPlace.splice(idx, 1);
        
        currentShipLength = 0; 
        renderPlacementBoard();
        renderShipSelection();

        if (shipsToPlace.length === 0) {
            document.getElementById('finish-placement-btn').disabled = false;
        }
    }
}

function previewPlacement(startIndex, isHover) {
    if (!isPlacementPhase || currentShipLength === 0) return;

    const boardCells = document.getElementById('my-placement-board').children;
    const shipCells = getShipCells(startIndex, currentShipLength, currentShipOrientation);
    const valid = isValidPlacement(shipCells);

    // Clear old hovers
    for(let cell of boardCells) {
        cell.classList.remove('hover-valid', 'hover-invalid');
    }

    if (isHover && shipCells) {
        shipCells.forEach(idx => {
            if (boardCells[idx]) {
                boardCells[idx].classList.add(valid ? 'hover-valid' : 'hover-invalid');
            }
        });
    }
}

window.finishPlacement = () => {
    if (gameMode === 'fantasy' && !playerFaction) {
        alert("Please select a faction before starting the battle!");
        return;
    }
    playerReady = true;

    if (isOfflineMode) {
        startGameUI(); 
    } else {
        const updates = {};
        updates[`${playerRole}/ready`] = true;
        updates[`${playerRole}/board`] = placedShips;
        updates[`${playerRole}/shipObjects`] = placedShipObjects;
        if (gameMode === 'fantasy') {
            updates[`${playerRole}/faction`] = playerFaction;
        }

        // Upload board and readiness
        update(ref(db, `games/${gameCode}`), updates);
        
        document.getElementById('placement-message').innerText = "Waiting for opponent...";
        document.getElementById('waiting-for-opponent').classList.remove('hidden');
        document.getElementById('finish-placement-btn').classList.add('hidden');
        
        listenForOpponentReady();
    }
};

// --- GAME START & LOOP ---

function listenForOpponentReady() {
    // Wait for BOTH checks to be true
    onValue(ref(db, `games/${gameCode}`), (snapshot) => {
        const data = snapshot.val();
        if (data && data.host && data.guest && data.host.ready && data.guest.ready) {
             startGameUI();
        }
    });
}

function startGameUI() {
    console.log("Starting Game UI...");
    myShips = [...placedShips]; // Lock in ships
    isPlacementPhase = false;

    document.getElementById('ship-status-panel').classList.add('hidden'); // Ensure UAV panel is hidden on start

    if (isOfflineMode) {
        const robotData = generateShipsForRobot();
        robotShips = robotData.board;
        robotShipObjects = robotData.shipObjects;
        opponentShips = [...robotShips];

        const factions = ['military', 'mages', 'vikings'];
        const robotFaction = factions[Math.floor(Math.random() * factions.length)];

        gameState = {
            roundCount: 0,
            host: {
                board: myShips,
                shipObjects: placedShipObjects,
                hits: [], // robot hits on me
                misses: [], // robot misses on me
                faction: playerFaction,
                energy: 1,
                uavActive: false,
                riftCooldown: 0,
            },
            guest: { // The robot is the guest
                board: robotShips,
                shipObjects: robotShipObjects,
                hits: [], // my hits on robot
                misses: [], // my misses on robot
                faction: robotFaction,
                energy: 0,
                uavActive: false,
                riftCooldown: 0,
            },
            turn: 'host',
            gameMode: gameMode,
        };
        playerEnergy = 1;
        isMyTurn = true;
    }

    const startBattle = () => {
        document.getElementById('placement-panel').classList.add('hidden');
        document.getElementById('game-arena').classList.remove('hidden');

        if (gameMode === 'fantasy') {
            document.getElementById('skills-panel').classList.remove('hidden');
            updateSkillsUI();
        }
        
        // Initial render, will be updated by listener
        renderBoard('my-board', myShips, [], [], true);
        renderBoard('enemy-board', [], [], [], false);
        
        // Determine turn (Host starts)
        // This will be set by the listener based on game state
        // isMyTurn = (playerRole === 'host');
        updateTurnIndicator();

        if (!isOfflineMode) listenForMoves();
    };

    if (isOfflineMode) {
        startBattle();
    } else {
        // Download Enemy Board ONCE
        const opponentRole = (playerRole === 'host') ? 'guest' : 'host';
        onValue(ref(db, `games/${gameCode}/${opponentRole}/board`), (snapshot) => { 
            opponentShips = snapshot.val() || []; // Safety check
            startBattle(); 
        }, { onlyOnce: true });
    }
}

function renderBoard(elementId, ships, hits, misses, isMine) {
    const board = document.getElementById(elementId);
    board.innerHTML = ''; 
    for (let i = 0; i < 100; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;

        if (isMine && ships.includes(i)) {
            cell.classList.add('ship');
        }
        if (hits.includes(i)) {
            cell.classList.add('hit');
        }
        if (misses.includes(i)) {
            cell.classList.add('miss');
        }
        if (!isMine) {
            cell.onclick = () => fireShot(i);
            // Add hover events for skill previews
            if (gameMode === 'fantasy') {
                cell.onmouseover = () => previewSkill(i, true);
                cell.onmouseout = () => previewSkill(i, false);
            }
        }
        board.appendChild(cell);
    }
}

// --- SHOOTING LOGIC ---

function updateStatusTimers() {
    const container = document.getElementById('status-timers-container');
    container.innerHTML = ''; // Clear existing timers
    const myData = gameState[playerRole] || {};
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole] || {};

    // Timer for when I am disabled
    if (myData.skillsDisabled && myData.skillsDisabled > 0) {
        container.innerHTML += `<div class="status-timer">YOUR SKILLS DISABLED: ${myData.skillsDisabled} TURN(S)</div>`;
    }
    // Timer for when my opponent is disabled
    if (opponentData.skillsDisabled && opponentData.skillsDisabled > 0) {
        container.innerHTML += `<div class="status-timer">ENEMY SKILLS DISABLED: ${opponentData.skillsDisabled} TURN(S)</div>`;
    }
}
window.activateSkill = (skillType) => {
    if (!isMyTurn || playerEnergy < skillCosts[skillType]) return;

    const nonTargetedSkills = {
        mages: ['utility', 'ultimate'], // Temporal Rift, Armageddon
        vikings: ['attack', 'utility'], // Berserker's Sacrifice, Odin's Ravens
        military: ['utility'] // UAV Recon Drone
    };

    // --- NEW: Viking Ultimate Mode Cycling ---
    if (skillType === 'ultimate' && playerFaction === 'vikings') {
        if (activeSkill !== 'ultimate') { // First click to activate
            activeSkill = 'ultimate';
            vikingUltMode = 'rows_and_cols';
        } else { // Subsequent clicks to cycle mode
            if (vikingUltMode === 'rows_and_cols') {
                vikingUltMode = 'two_rows';
            } else if (vikingUltMode === 'two_rows') {
                vikingUltMode = 'two_cols';
            } else { // Was 'two_cols', so deactivate
                activeSkill = null;
                document.getElementById('turn-indicator').innerText = "(YOUR TURN)";
                document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
                previewSkill(0, false);
                updateSkillsUI(); // Reset button text
                return;
            }
        }
        // Update UI to show the new mode and highlight the button
        updateSkillsUI();
        document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
        document.getElementById('skill-ultimate-btn').classList.add('active');
        document.getElementById('turn-indicator').innerText = `(YOUR TURN) - USE ULTIMATE SKILL`;
        return; // Exit to prevent default activation logic
    }

    if (nonTargetedSkills[playerFaction]?.includes(skillType)) {
        useSkill(skillType); // Call useSkill immediately without a target
        return;
    }

    // Deselect if clicking the same skill again
    if (activeSkill === skillType) {
        activeSkill = null;
        document.getElementById('turn-indicator').innerText = "(YOUR TURN)";
        document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
        updateSkillsUI(); // Reset any special button text
        previewSkill(0, false); // Clear any lingering preview
        return;
    }

    activeSkill = skillType;
    document.getElementById('turn-indicator').innerText = `(YOUR TURN) - USE ${skillType.toUpperCase()} SKILL`;

    // Highlight active skill
    document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
    document.getElementById(`skill-${skillType}-btn`).classList.add('active');
};

function fireShot(index) {
    if (isPlacementPhase) return;
    if (!isMyTurn) return alert("Not your turn!");

    // Safety: Don't shoot existing hits/misses
    const cell = document.getElementById('enemy-board').children[index];
    if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;

    if (gameMode === 'fantasy' && activeSkill) {
        useSkill(activeSkill, index);
    } else {
        // Standard single shot
        processShot(index);
    }
}

function useSkill(skillType, targetIndex) { // targetIndex can be undefined
    const cost = skillCosts[skillType];
    if (playerEnergy < cost) return;

    const updates = {};
    updates[`${playerRole}/energy`] = playerEnergy - cost;
    updates['turn'] = playerRole === 'host' ? 'guest' : 'host'; // Skills always end the turn

    let isUltimateAnimating = false; // Flag to defer the update
    // Call the correct skill function which will ADD to the updates object
    switch (playerFaction) {
        case 'military':
            if (skillType === 'attack') useMilitaryCrossfire(targetIndex, updates);
            else if (skillType === 'utility') useMilitaryUAV(updates);
            else if (skillType === 'ultimate') {
                useMilitaryNuke(targetIndex, updates);
                isUltimateAnimating = true;
            }
            break;
        case 'mages':
            if (skillType === 'attack') useMageFireball(targetIndex, updates);
            else if (skillType === 'utility') useMageTemporalRift(updates);
            else if (skillType === 'ultimate') {
                // Armageddon is special-cased to handle its own async update after animation
                useMageArmageddon(updates);
                isUltimateAnimating = true;
            }
            break;
        case 'vikings':
            if (skillType === 'attack') useVikingBerserker(updates);
            else if (skillType === 'utility') useVikingRavens(updates);
            else if (skillType === 'ultimate') {
                useVikingJormungandr(targetIndex, updates);
                isUltimateAnimating = true;
            }
            break;
    }

    if (!isUltimateAnimating) {
        if (isOfflineMode) {
            applyOfflineUpdates(updates);
        } else {
            update(ref(db, `games/${gameCode}`), updates);
        }
    }

    // Reset active skill UI state after using a skill
    activeSkill = null;
    document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
    // updateTurnIndicator is called by the update handlers now
    previewSkill(0, false); // Clear preview
}

function useMilitaryCrossfire(index, updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const currentHits = opponentData.hits ? [...opponentData.hits] : [];
    const currentMisses = opponentData.misses ? [...opponentData.misses] : [];

    const targets = getSkillTargets('attack', 'military', index);

    targets.forEach(targetIdx => {
        if (currentHits.includes(targetIdx) || currentMisses.includes(targetIdx)) return; // Don't re-shoot
        if (opponentShips.includes(targetIdx)) currentHits.push(targetIdx);
        else currentMisses.push(targetIdx);
    });

    updates[`${opponentRole}/hits`] = currentHits;
    updates[`${opponentRole}/misses`] = currentMisses;
}

function getEnemyShipStatus() {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    if (!opponentData || !opponentData.shipObjects) return [];

    const shipNames = { 5: "Carrier", 4: "Battleship", 3: "Cruiser", 2: "Destroyer" };
    const shipCounts = { 5: 0, 4: 0, 3: 0, 2: 0 };
    const shipReports = [];

    // Create a copy and sort to ensure consistent order (e.g., Carrier, Battleship, etc.)
    const sortedShips = [...opponentData.shipObjects].sort((a, b) => b.length - a.length);

    sortedShips.forEach(ship => {
        const remainingTiles = ship.indices.filter(index => !(opponentData.hits || []).includes(index)).length;
        const shipName = shipNames[ship.length];
        let reportName = shipName;

        const totalOfType = opponentData.shipObjects.filter(s => s.length === ship.length).length;
        if (totalOfType > 1) {
            shipCounts[ship.length]++;
            reportName = `${shipName} #${shipCounts[ship.length]}`;
        }

        shipReports.push({
            name: reportName,
            remaining: remainingTiles,
            total: ship.length
        });
    });

    return shipReports;
}

function useMilitaryUAV(updates) {
    // This skill is now purely informational for the user.
    // It enables the persistent panel.
    updates[`${playerRole}/uavActive`] = true;
}

function useMilitaryNuke(index, updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const currentHits = opponentData.hits ? [...opponentData.hits] : [];
    const currentMisses = opponentData.misses ? [...opponentData.misses] : [];

    const targets = getSkillTargets('ultimate', 'military', index);
    const enemyBoard = document.getElementById('enemy-board');

    triggerScreenShake();


    // Apply temporary visual effect
    enemyBoard.classList.add('disabled'); // Disable interaction during animation
    targets.forEach(targetIdx => {
        const cell = enemyBoard.children[targetIdx];
        if (cell) cell.classList.add('nuke-impact');
    });

    setTimeout(() => {
        targets.forEach(targetIdx => {

            const cell = enemyBoard.children[targetIdx];
            if (cell) cell.classList.remove('nuke-impact');
        });
        enemyBoard.classList.remove('disabled'); // Re-enable interaction


        // Apply actual game state changes after animation
        targets.forEach(targetIdx => {
            if (currentHits.includes(targetIdx) || currentMisses.includes(targetIdx)) return;
            if (opponentShips.includes(targetIdx)) {
                currentHits.push(targetIdx);
            } else {
                currentMisses.push(targetIdx);
            }
        });

        updates[`${opponentRole}/hits`] = currentHits;
        updates[`${opponentRole}/misses`] = currentMisses;

        if (isOfflineMode) {
            applyOfflineUpdates(updates);
        } else {
            update(ref(db, `games/${gameCode}`), updates);
        }
    }, 800); // Match the animation duration
}




function useMageFireball(index, updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const currentHits = opponentData.hits ? [...opponentData.hits] : [];
    const currentMisses = opponentData.misses ? [...opponentData.misses] : [];

    const targets = getSkillTargets('attack', 'mages', index);

    targets.forEach(targetIdx => {
        if (currentHits.includes(targetIdx) || currentMisses.includes(targetIdx)) return; // Don't re-shoot
        if (opponentShips.includes(targetIdx)) {
            currentHits.push(targetIdx);
            // Find the ship object to apply a burn effect
            const hitShip = gameState[opponentRole].shipObjects.find(ship => ship.indices.includes(targetIdx));
            if (hitShip && !opponentData.burnEffect?.active) { // Don't overwrite an existing burn
                updates[`${opponentRole}/burnEffect`] = { active: true, shipIndices: hitShip.indices };
            }
        } else {
            currentMisses.push(targetIdx);
        }
    });

    updates[`${opponentRole}/hits`] = currentHits;
    updates[`${opponentRole}/misses`] = currentMisses;
}

function useMageTemporalRift(updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const opponentBoard = opponentData.board;
    const opponentHits = opponentData.hits || [];

    const unhitShipTiles = opponentBoard.filter(tile => !opponentHits.includes(tile));

    if (unhitShipTiles.length > 0) {
        const randomTile = unhitShipTiles[Math.floor(Math.random() * unhitShipTiles.length)];
        // Reveal it by marking it as a hit.
        const newHits = [...opponentHits, randomTile];
        updates[`${opponentRole}/hits`] = newHits;
    }
    // If no unhit tiles, the skill does nothing but still costs energy and a turn.

    // Mage keeps the turn
    updates['turn'] = playerRole;

    // NEW: Set the skill on cooldown for 3 turns (current extra, opponent's, your next)
    updates[`${playerRole}/riftCooldown`] = 3;
}

function calculateMageArmageddon() {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const currentHits = opponentData.hits ? [...opponentData.hits] : [];
    const currentMisses = opponentData.misses ? [...opponentData.misses] : [];
    const opponentShots = [...currentHits, ...currentMisses];

    let availableTiles = Array.from({ length: 100 }, (_, i) => i)
        .filter(i => !opponentShots.includes(i));

    const meteorCount = Math.floor(Math.random() * 3) + 6; // 6, 7, or 8
    const animationTargets = []; // Store each meteor's splash for animation
    const allImpacts = new Set();

    for (let i = 0; i < meteorCount; i++) {
        if (availableTiles.length === 0) break; // No more unshot tiles to target

        let bestCenter = -1;
        let maxNewHits = -1;

        // Prioritize central tiles for meteor impact centers
        const centralCandidates = availableTiles.filter(idx => {
            const row = Math.floor(idx / 10);
            const col = idx % 10;
            return row >= 2 && row <= 7 && col >= 2 && col <= 7; // Central 6x6 area
        });

        const candidatesToSample = centralCandidates.length > 0 ? centralCandidates : availableTiles;
        const sampleSize = Math.min(candidatesToSample.length, 25); // Sample up to 25 candidates
        const sampledCandidates = candidatesToSample.sort(() => 0.5 - Math.random()).slice(0, sampleSize);

        if (sampledCandidates.length === 0) {
            bestCenter = availableTiles[Math.floor(Math.random() * availableTiles.length)]; // Fallback
        } else {
            for (const center of sampledCandidates) { // Iterate through sampled candidates
                const splash = getSkillTargets('attack', 'military', center);
                // Calculate how many tiles in the splash are new hits
                const newHits = splash.filter(t => !allImpacts.has(t) && !opponentShots.includes(t)).length;
                if (newHits > maxNewHits) {
                    maxNewHits = newHits;
                    bestCenter = center;
                }
            }
            // Fallback if no best center determined
            if (bestCenter === -1) {
                bestCenter = sampledCandidates[0];
            }
        }

        const bestSplash = getSkillTargets('attack', 'military', bestCenter);
        animationTargets.push(bestSplash);
        bestSplash.forEach(tile => allImpacts.add(tile));

        // Remove used tiles from future consideration as centers
        availableTiles = availableTiles.filter(t => !allImpacts.has(t));
    }

    const finalHits = [...currentHits];
    const finalMisses = [...currentMisses];

    allImpacts.forEach(targetIdx => {
        if (finalHits.includes(targetIdx) || finalMisses.includes(targetIdx)) return;
        if (opponentShips.includes(targetIdx)) finalHits.push(targetIdx);
        else finalMisses.push(targetIdx);
    });

    return { finalHits, finalMisses, animationTargets };
}

function animateArmageddon(meteorSplashes, onComplete) {
    const enemyBoard = document.getElementById('enemy-board');
    let delay = 0;
    const meteorDelay = 250; // ms between meteors

    enemyBoard.classList.add('disabled'); // Disable interaction during animation

    meteorSplashes.forEach(splash => {
        setTimeout(() => {
            splash.forEach(targetIdx => {
                const cell = enemyBoard.children[targetIdx];
                if (cell) {
                    cell.classList.add('meteor-impact'); // Temporary visual effect
                    setTimeout(() => cell.classList.remove('meteor-impact'), meteorDelay);
                }
            });
        }, delay);
        delay += meteorDelay;
    });

    setTimeout(onComplete, delay + meteorDelay); // Call completion callback after animation
}

function useMageArmageddon(updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const { finalHits, finalMisses, animationTargets } = calculateMageArmageddon();

    triggerScreenShake();

    // Add final results to the updates object that already contains energy/turn changes
    updates[`${opponentRole}/hits`] = finalHits;
    updates[`${opponentRole}/misses`] = finalMisses;

    // Animate on the client, then send the final state update
    animateArmageddon(animationTargets, () => {
        if (isOfflineMode) {
            applyOfflineUpdates(updates);
        } else {
            update(ref(db, `games/${gameCode}`), updates);
        }
    });
}

function useVikingBerserker(updates) {
    const myData = gameState[playerRole];
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];

    // 1. Damage self: Destroy 2 random healthy parts of your own ships
    const myBoard = myData.board;
    const myHits = myData.hits || [];
    const myHealthyTiles = myBoard.filter(tile => !myHits.includes(tile));

    if (myHealthyTiles.length > 0) {
        const tilesToDestroy = myHealthyTiles.sort(() => 0.5 - Math.random()).slice(0, 3);
        updates[`${playerRole}/hits`] = [...myHits, ...tilesToDestroy];
    }

    // 2. Damage enemy: Destroy 1 random enemy ship completely
    const opponentShipObjects = opponentData.shipObjects;
    const opponentHits = opponentData.hits || [];
    const healthyShips = opponentShipObjects.filter(ship =>
        !ship.indices.every(index => opponentHits.includes(index))
    );

    if (healthyShips.length > 0) {
        const shipToDestroy = healthyShips[Math.floor(Math.random() * healthyShips.length)];
        const newOpponentHits = [...opponentHits];
        shipToDestroy.indices.forEach(index => {
            if (!newOpponentHits.includes(index)) {
                newOpponentHits.push(index);
            }
        });
        updates[`${opponentRole}/hits`] = newOpponentHits;
    }
}

function useVikingRavens(updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const opponentBoard = opponentData.board;
    const opponentShots = [...(opponentData.hits || []), ...(opponentData.misses || [])];

    const availableWaterTiles = Array.from({ length: 100 }, (_, i) => i)
        .filter(i => !opponentBoard.includes(i) && !opponentShots.includes(i));

    const tilesToReveal = availableWaterTiles.sort(() => 0.5 - Math.random()).slice(0, 6);
    if (tilesToReveal.length > 0) {
        updates[`${opponentRole}/misses`] = [...(opponentData.misses || []), ...tilesToReveal];
    }

    // NEW: Debuff the opponent
    updates[`${opponentRole}/skillsDisabled`] = 2; // Debuff for 2 of their turns

    // NEW: Client-side visual effect for the player who used the skill
    const overlay = document.getElementById('enemy-board-overlay');
    if (overlay) {
        overlay.classList.add('raven-storm');
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('raven-storm');
        }, 4000); // Match animation duration + buffer
    }
}

function useVikingJormungandr(index, updates) {
    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const opponentData = gameState[opponentRole];
    const currentHits = opponentData.hits ? [...opponentData.hits] : [];
    const currentMisses = opponentData.misses ? [...opponentData.misses] : [];

    const targets = getSkillTargets('ultimate', 'vikings', index);
    const enemyBoard = document.getElementById('enemy-board');

    triggerScreenShake();

    // Apply temporary visual effect
    enemyBoard.classList.add('disabled'); // Disable interaction during animation
    targets.forEach(targetIdx => {
        const cell = enemyBoard.children[targetIdx];
        if (cell) cell.classList.add('jormungandr-sweep');
    });

    setTimeout(() => {
        targets.forEach(targetIdx => {
            const cell = enemyBoard.children[targetIdx];
            if (cell) cell.classList.remove('jormungandr-sweep');
        });
        enemyBoard.classList.remove('disabled'); // Re-enable interaction

        // Apply actual game state changes after animation
        const uniqueTargets = [...new Set(targets)]; // Ensure no double processing
        uniqueTargets.forEach(targetIdx => {
            if (currentHits.includes(targetIdx) || currentMisses.includes(targetIdx)) return;
            if (opponentShips.includes(targetIdx)) currentHits.push(targetIdx);
            else currentMisses.push(targetIdx);
        });
        updates[`${opponentRole}/hits`] = currentHits;
        updates[`${opponentRole}/misses`] = currentMisses;

        if (isOfflineMode) {
            applyOfflineUpdates(updates);
        } else {
            update(ref(db, `games/${gameCode}`), updates);
        }
    }, 800); // Duration of sweep animation + a little extra
}

function processShot(index) {
    const enemyBoard = document.getElementById('enemy-board');

    const cell = enemyBoard.children[index];
    
    // Safety: Don't shoot existing hits/misses
    if (cell.classList.contains('hit') || cell.classList.contains('miss')) return;

    const opponentRole = playerRole === 'host' ? 'guest' : 'host';
    const myData = isOfflineMode ? gameState[playerRole] : gameState[playerRole];
    const opponentData = isOfflineMode ? gameState[opponentRole] : gameState[opponentRole];
    const updates = {};

    if (isOfflineMode) { // Special handling for offline updates
        if (opponentShips.includes(index)) {
            updates[`${opponentRole}/hits`] = [...(opponentData.hits || []), index];
            updates['turn'] = playerRole;
            if (gameMode === 'fantasy') {
                updates[`${playerRole}/energy`] = (myData.energy || 0) + 1;
            }
        } else {
            updates[`${opponentRole}/misses`] = [...(opponentData.misses || []), index];
            updates['turn'] = opponentRole;
            // In offline, turn change energy is handled by robotTurn, but we check for burn here
            if (gameMode === 'fantasy' && opponentData.burnEffect?.active) {
                applyBurn(opponentRole, opponentData, updates);
            }
        }
        applyOfflineUpdates(updates);
    } else {
        const targetBoard = opponentShips; // From online listener

        if (targetBoard.includes(index)) {
            updates[`${opponentRole}/hits`] = [...(opponentData.hits || []), index];
            updates['turn'] = playerRole; // Player hits, keeps the turn
            // Bonus energy for hitting with a normal shot
            if (gameMode === 'fantasy') {
                updates[`${playerRole}/energy`] = (myData.energy || 0) + 1;
            }
        } else {
            updates[`${opponentRole}/misses`] = [...(opponentData.misses || []), index];
            updates['turn'] = opponentRole; // Player misses, turn goes to opponent
            // Energy is handled by listenForMoves when turn changes (opponent gets +1)
        }
        update(ref(db, `games/${gameCode}`), updates);
    }
}

function listenForMoves() {
    onValue(ref(db, `games/${gameCode}`), (snapshot) => {
        gameState = snapshot.val();
        if (!gameState || !gameState.status || gameState.status === 'waiting') return; // Game not ready

        // Sync game mode from Firebase. This is crucial for the guest player.
        gameMode = gameState.gameMode || 'normal';

        // --- Turn Change Logic (Energy Gain at start of turn) ---
        // Only grant energy when a turn transition happens, and only to the player whose turn it is now
        if (gameState.turn !== previousTurn) {
            const newTurnPlayer = gameState.turn;
            const updates = {};
            
            // Only add energy when it becomes someone's turn (NOT for the player who just ended their turn)
            // Only update if we're the ones writing the energy
            if (gameMode === 'fantasy' && newTurnPlayer === playerRole) {
                updates[`${newTurnPlayer}/energy`] = (gameState[newTurnPlayer].energy || 0) + 1;
                
                // NEW: Decrement Mage rift cooldown at start of turn
                if (gameState[newTurnPlayer].faction === 'mages' && gameState[newTurnPlayer].riftCooldown > 0) {
                    updates[`${newTurnPlayer}/riftCooldown`] = gameState[newTurnPlayer].riftCooldown - 1;
                }
            }

            // NEW: Check for and clear the skillsDisabled debuff at the start of the turn
            const playerBeingDebuffed = gameState[newTurnPlayer] || {};
            if (playerBeingDebuffed.skillsDisabled && newTurnPlayer === playerRole) {
                if (playerBeingDebuffed.skillsDisabled > 1) {
                    updates[`${newTurnPlayer}/skillsDisabled`] = playerBeingDebuffed.skillsDisabled - 1;
                } else {
                    updates[`${newTurnPlayer}/skillsDisabled`] = null; // Remove the key
                }
            }

            // NEW: Increment round count when turn returns to host
            if (previousTurn === 'guest' && newTurnPlayer === 'host') {
                updates['roundCount'] = (gameState.roundCount || 0) + 1;
            }

            // Apply burn effect if active for the new turn player
            const newTurnPlayerData = gameState[newTurnPlayer];
            if (newTurnPlayerData?.burnEffect?.active) {
                const burningShipIndices = newTurnPlayerData.burnEffect.shipIndices;
                const currentHits = newTurnPlayerData.hits || [];
                const unburntPart = burningShipIndices.find(index => !currentHits.includes(index));

                if (unburntPart !== undefined) { // There's still a part to burn
                    updates[`${newTurnPlayer}/hits`] = [...currentHits, unburntPart];
                } else {
                    // If no unburnt part, but burnEffect is still active, extinguish it.
                    updates[`${newTurnPlayer}/burnEffect`] = { active: false, shipIndices: [] };
                }
            }
            
            // Update previousTurn before any Firebase write to prevent recursion
            previousTurn = gameState.turn;
            
            if (Object.keys(updates).length > 0) {
                update(ref(db, `games/${gameCode}`), updates);
                return; // Exit early to avoid processing UI with potentially outdated local state
            }
        }
        previousTurn = gameState.turn;

        const myRole = playerRole;
        const opponentRole = myRole === 'host' ? 'guest' : 'host';

        const myData = gameState[myRole];
        const opponentData = gameState[opponentRole];

        // Update local state from Firebase
        myShips = myData.board || [];
        opponentShips = opponentData.board || [];
        playerEnergy = myData.energy || 0;
        playerFaction = myData.faction || ''; // Ensure faction is synced for all players

        // Get all shots from the state, with safety defaults for empty arrays
        const myHits = myData.hits || [];
        const myMisses = myData.misses || [];
        const enemyHits = opponentData.hits || [];
        const enemyMisses = opponentData.misses || [];

        // Re-render both boards with the complete history
        renderBoard('my-board', myShips, myHits, myMisses, true);
        renderBoard('enemy-board', [], enemyHits, enemyMisses, false);

        isMyTurn = gameState.turn === playerRole;

        updateTurnIndicator();
        if (gameMode === 'fantasy') {
            updateSkillsUI();
            updateStatusTimers();
            updateUAVPanel();
        }
        checkGameOver();
    });
}

function applyBurn(targetRole, targetData, updates) {
    const burningShipIndices = targetData.burnEffect.shipIndices;
    const currentHits = targetData.hits || [];
    
    // Find a part of the burning ship that hasn't been hit yet
    const unburntPart = burningShipIndices.find(index => !currentHits.includes(index));

    if (unburntPart !== undefined) {
        const newHits = [...currentHits, unburntPart];
        updates[`${targetRole}/hits`] = newHits;

        // Check if the burn has destroyed the whole ship
        const isFullyBurnt = burningShipIndices.every(index => newHits.includes(index));
        if (isFullyBurnt) {
            updates[`${targetRole}/burnEffect`] = { active: false, shipIndices: [] }; // Extinguish
        }
    } else {
        // This case handles if the ship was already destroyed by other means
        updates[`${targetRole}/burnEffect`] = { active: false, shipIndices: [] }; // Extinguish
    }
}

function applyOfflineUpdates(updates) {
    const oldTurn = gameState.turn; // Capture turn before update

    // 1. Apply updates to local gameState
    for (const key in updates) {
        const path = key.split('/');
        if (path.length === 2) {
            gameState[path[0]][path[1]] = updates[key];
        } else {
            gameState[key] = updates[key];
        }
    }

    // Centralized energy gain on turn change for offline mode
    if (gameMode === 'fantasy' && gameState.turn !== oldTurn) {
        const newTurnPlayer = gameState.turn;
        gameState[newTurnPlayer].energy = (gameState[newTurnPlayer].energy || 0) + 1;

        // Decrement Mage rift cooldown
        const newTurnPlayerData = gameState[newTurnPlayer];
        if (newTurnPlayerData.faction === 'mages' && newTurnPlayerData.riftCooldown > 0) {
            newTurnPlayerData.riftCooldown--;
        }

        // Decrement skill debuff
        const debuffedPlayer = gameState[newTurnPlayer];
        if (debuffedPlayer?.skillsDisabled > 0) {
            debuffedPlayer.skillsDisabled--;
            if (debuffedPlayer.skillsDisabled === 0) {
                debuffedPlayer.skillsDisabled = null;
            }
        }

        // Increment round count
        if (oldTurn === 'guest' && newTurnPlayer === 'host') {
            gameState.roundCount = (gameState.roundCount || 0) + 1;
        }
    }

    // 2. Sync local variables and UI from gameState
    const myData = gameState[playerRole];
    const opponentData = gameState[playerRole === 'host' ? 'guest' : 'host'];
    playerEnergy = myData.energy;
    isMyTurn = gameState.turn === playerRole;

    renderBoard('my-board', myData.board, myData.hits, myData.misses, true);
    renderBoard('enemy-board', [], opponentData.hits, opponentData.misses, false);

    updateTurnIndicator();
    updateSkillsUI();
    updateStatusTimers();
    updateUAVPanel();
    checkGameOver();

    // 3. Handle next turn for robot
    if (!isMyTurn) setTimeout(robotTurn, 1000);
}

function getSkillTargets(skillType, faction, index) {
    let targets = [];
    const startRow = Math.floor(index / 10);
    const startCol = index % 10;

    if (faction === 'military') {
        if (skillType === 'attack') { // Crossfire (+)
            targets.push(index);
            if (startRow > 0) targets.push(index - 10); // Up
            if (startRow < 9) targets.push(index + 10); // Down
            if (startCol > 0) targets.push(index - 1);  // Left
            if (startCol < 9) targets.push(index + 1);  // Right
        } else if (skillType === 'utility' || skillType === 'ultimate') { // Radar Scan or Nuke (5x5)
            for (let r = -2; r <= 2; r++) {
                for (let c = -2; c <= 2; c++) {
                    const newRow = startRow + r;
                    const newCol = startCol + c;
                    if (newRow >= 0 && newRow < 10 && newCol >= 0 && newCol < 10) {
                        targets.push(newRow * 10 + newCol);
                    }
                }
            }
        }
    } else if (faction === 'mages') {
        if (skillType === 'attack') { // Fireball (2x2)
            targets.push(index);
            if (startCol < 9) targets.push(index + 1);
            if (startRow < 9) {
                targets.push(index + 10);
                if (startCol < 9) targets.push(index + 11);
            }
        }
    } else if (faction === 'vikings') {
        if (skillType === 'ultimate') { // Jormungandr's Rage
            const row = Math.floor(index / 10);
            const col = index % 10;
            if (vikingUltMode === 'rows_and_cols') {
                // Add all tiles in the row and column
                for (let i = 0; i < 10; i++) { targets.push(row * 10 + i); }
                for (let i = 0; i < 10; i++) { targets.push(i * 10 + col); }
            } else if (vikingUltMode === 'two_rows') {
                // Preview just the hovered row
                for (let i = 0; i < 10; i++) { targets.push(row * 10 + i); }
            } else if (vikingUltMode === 'two_cols') {
                // Preview just the hovered column
                for (let i = 0; i < 10; i++) { targets.push(i * 10 + col); }
            }
        }
    }
    // Other skills are non-targeted, so they aren't handled here for previews.
    return targets.filter(t => t >= 0 && t < 100); // Final safety filter
}

function previewSkill(startIndex, isHover) {
    if (!isMyTurn || !activeSkill) return;

    const boardCells = document.getElementById('enemy-board').children;

    // Clear any existing preview classes first
    for (let cell of boardCells) {
        cell.classList.remove('hover-skill');
    }

    if (isHover) {
        const skillTargets = getSkillTargets(activeSkill, playerFaction, startIndex);

        if (skillTargets.length > 0) {
            skillTargets.forEach(idx => {
                if (boardCells[idx]) {
                    boardCells[idx].classList.add('hover-skill');
                }
            });
        } else {
            // If no specific target logic, just highlight the single cell
            boardCells[startIndex].classList.add('hover-skill');
        }
    }
}

function robotConsiderAndUseSkill() {
    if (gameMode !== 'fantasy') return null;

    const robotData = gameState.guest;
    const playerData = gameState.host;
    const robotEnergy = robotData.energy || 0;
    const robotFaction = robotData.faction;
    let skillToUse = null;
    let targetIndex = -1;
    let cost = 0;

    // Simple decision logic: check from most expensive to least expensive
    // Ultimate
    if (robotEnergy >= skillCosts.ultimate && Math.random() < 0.6) { // 60% chance
        skillToUse = 'ultimate';
        cost = skillCosts.ultimate;
    }
    // Utility
    else if (robotEnergy >= skillCosts.utility && Math.random() < 0.5) { // 50% chance
        skillToUse = 'utility';
        cost = skillCosts.utility;
    }
    // Attack
    else if (robotEnergy >= skillCosts.attack && Math.random() < 0.4) { // 40% chance
        skillToUse = 'attack';
        cost = skillCosts.attack;
    }

    if (!skillToUse) return null;

    const updates = {};
    const unshotTiles = Array.from({ length: 100 }, (_, i) => i).filter(i => !robotShots.includes(i));
    if (unshotTiles.length === 0) return null; // No place to shoot

    // Faction-specific targeting and skill adjustments
    switch (robotFaction) {
        case 'military':
            // UAV is non-targeted, so only find a target for attack/ultimate
            if (skillToUse !== 'utility') {
                targetIndex = unshotTiles[Math.floor(Math.random() * unshotTiles.length)];
            }
            break;
        case 'mages':
            if (skillToUse === 'attack') { // Fireball needs a target
                targetIndex = unshotTiles[Math.floor(Math.random() * unshotTiles.length)];
            }
            // Temporal Rift and Armageddon are non-targeted
            break;
        case 'vikings':
            if (skillToUse === 'ultimate') { // Jormungandr
                vikingUltMode = 'rows_and_cols'; // Set mode for robot
                targetIndex = unshotTiles[Math.floor(Math.random() * unshotTiles.length)];
            } else if (skillToUse === 'attack') { // Berserker's Sacrifice
                // Only use if the robot has taken some damage or is losing
                const robotHitsSustained = robotData.hits?.length || 0;
                const playerHitsDealt = playerData.hits?.length || 0;
                if (robotHitsSustained < 5 && playerHitsDealt < 8) {
                    return null; // Don't use skill
                }
            }
            // Odin's Ravens is non-targeted
            break;
    }

    // --- Prepare and execute the skill ---
    updates['guest/energy'] = robotEnergy - cost;
    updates['turn'] = 'host'; // Skills always end the turn

    // Temporarily set playerRole for skill functions to work correctly
    const originalPlayerRole = playerRole;
    playerRole = 'guest';

    let isUltimateAnimating = false;
    const skillFunctions = {
        military: { attack: useMilitaryCrossfire, utility: useMilitaryUAV, ultimate: useMilitaryNuke },
        mages: { attack: useMageFireball, utility: useMageTemporalRift, ultimate: useMageArmageddon },
        vikings: { attack: useVikingBerserker, utility: useVikingRavens, ultimate: useVikingJormungandr }
    };
    const nonTargetedSkills = {
        mages: ['utility', 'ultimate'],
        vikings: ['attack', 'utility'],
        military: ['utility']
    };

    const skillFn = skillFunctions[robotFaction]?.[skillToUse];
    if (skillFn) {
        if (skillToUse === 'ultimate') isUltimateAnimating = true;

        if (nonTargetedSkills[robotFaction]?.includes(skillToUse)) {
            skillFn(updates);
        } else {
            skillFn(targetIndex, updates);
        }
    }

    // Restore playerRole
    playerRole = originalPlayerRole;

    // For animated skills, the skill function handles the update. For others, we return the updates.
    if (isUltimateAnimating) {
        return 'animated'; // Special value to tell robotTurn to just wait
    }
    return updates;
}

function robotTurn() {
    if (isMyTurn) return;

    // --- SKILL USAGE PHASE ---
    const skillUpdates = robotConsiderAndUseSkill();
    if (skillUpdates) {
        if (skillUpdates === 'animated') {
            // The animation function will handle the update and turn change.
            return; // Stop the robot from taking another action.
        }
        applyOfflineUpdates(skillUpdates);
        return; // End turn after using skill
    }

    // --- NORMAL SHOT PHASE (if no skill was used) ---
    let shotIndex = -1;

    // 1. HUNT MODE: If we have targets in the queue, use them.
    if (robotState === 'hunting') {
        // Prioritize targets from the smart queue
        while (robotHuntQueue.length > 0 && shotIndex === -1) {
            let potentialTarget = robotHuntQueue.shift(); // Take from the front
            if (!robotShots.includes(potentialTarget)) {
                shotIndex = potentialTarget;
            }
        }
        // If the hunt queue is empty, it means we hit a dead end. Reset and search.
        if (shotIndex === -1) {
            resetRobotHunt();
            // Fall-through to search mode for this turn
        }
    }

    // 2. SEARCH MODE: If not hunting or hunt queue was empty, find a new target.
    if (robotState === 'searching') {
        const myData = gameState.host;
        const myShipObjects = myData.shipObjects || [];
        const myHits = myData.hits || [];

        // Find the smallest unsunk ship
        const unsunkShipLengths = myShipObjects
            .filter(ship => !ship.indices.every(index => myHits.includes(index)))
            .map(ship => ship.length);
        const smallestShipRemaining = unsunkShipLengths.length > 0 ? Math.min(...unsunkShipLengths) : 0;

        // Use a "checkerboard" pattern for more efficient searching
        let availableTiles = [];
        for (let i = 0; i < 100; i++) {
            const row = Math.floor(i / 10);
            const col = i % 10;
            if ((row + col) % 2 === 0 && !robotShots.includes(i)) { // Prioritize even-parity tiles
                availableTiles.push(i);
            }
        }
        // If no checkerboard tiles left, search all remaining tiles
        if (availableTiles.length === 0) {
            availableTiles = Array.from({ length: 100 }, (_, i) => i).filter(i => !robotShots.includes(i));
        }

        let validSearchTiles = [];
        if (smallestShipRemaining > 0) {
            validSearchTiles = availableTiles.filter(tile => {
                // Check horizontal possibilities that include 'tile'
                for (let i = 0; i < smallestShipRemaining; i++) {
                    const startPos = tile - i;
                    // Ensure the potential start is on the same row as the tile it's supposed to contain
                    if (Math.floor(startPos / 10) === Math.floor(tile / 10)) {
                        if (isPlacementPossible(startPos, smallestShipRemaining, 'horizontal', robotShots)) return true;
                    }
                }
                // Check vertical possibilities that include 'tile'
                for (let i = 0; i < smallestShipRemaining; i++) {
                    const startPos = tile - (i * 10);
                    if (startPos >= 0) {
                        if (isPlacementPossible(startPos, smallestShipRemaining, 'vertical', robotShots)) return true;
                    }
                }
                return false;
            });
        }

        const tilesToChooseFrom = validSearchTiles.length > 0 ? validSearchTiles : availableTiles;
        if (tilesToChooseFrom.length > 0) shotIndex = tilesToChooseFrom[Math.floor(Math.random() * tilesToChooseFrom.length)];
    }

    // Failsafe if no index was found (e.g., all tiles shot)
    if (shotIndex === -1) {
        const unshot = Array.from({length: 100}, (_, i) => i).filter(i => !robotShots.includes(i));
        if (unshot.length > 0) {
            shotIndex = unshot[0];
        } else {
            return; // Game is over, no moves left.
        }
    }

    robotShots.push(shotIndex);

    const updates = {};
    const myData = gameState.host;
    const myBoard = myData.board;

    if (myBoard.includes(shotIndex)) {
        // --- IT'S A HIT! ---
        const newHits = [...(myData.hits || []), shotIndex];
        updates['host/hits'] = newHits;
        updates['turn'] = 'guest'; // Robot hits, keeps the turn

        // --- SMARTER AI LOGIC ---
        // Find the specific ship that was just hit
        const hitShipObject = myData.shipObjects.find(ship => ship.indices.includes(shotIndex));

        // Check if THAT ship is now completely sunk
        const isNowSunk = hitShipObject && hitShipObject.indices.every(index => newHits.includes(index));

        if (isNowSunk) {
            // SHIP SUNK! Reset to searching mode for the next turn to find a new ship.
            resetRobotHunt();
        } else if (robotState === 'searching') {
            // This was a SEARCHING shot that HIT. Start a new HUNT.
            robotState = 'hunting';
            robotHuntInfo.firstHit = shotIndex;
            robotHuntInfo.knownHits.push(shotIndex);
            const { row, col } = { row: Math.floor(shotIndex / 10), col: shotIndex % 10 };
            const adjacent = [];
            if (row > 0) adjacent.push(shotIndex - 10); // up
            if (row < 9) adjacent.push(shotIndex + 10); // down
            if (col > 0) adjacent.push(shotIndex - 1);  // left
            if (col < 9) adjacent.push(shotIndex + 1);  // right
            robotHuntQueue = adjacent.filter(i => !robotShots.includes(i));
        } else { // Already in 'hunting' state and ship not sunk. Refine the hunt.
            robotHuntInfo.knownHits.push(shotIndex);

            if (!robotHuntInfo.orientation) {
                const firstHitRow = Math.floor(robotHuntInfo.firstHit / 10);
                const currentHitRow = Math.floor(shotIndex / 10);
                robotHuntInfo.orientation = (firstHitRow === currentHitRow) ? 'horizontal' : 'vertical';
            }

            const allHitsOnThisShip = robotHuntInfo.knownHits;
            const minHit = Math.min(...allHitsOnThisShip);
            const maxHit = Math.max(...allHitsOnThisShip);

            const newQueue = [];
            if (robotHuntInfo.orientation === 'horizontal') {
                if (minHit % 10 > 0) newQueue.push(minHit - 1);
                if (maxHit % 10 < 9) newQueue.push(maxHit + 1);
            } else { // Vertical
                if (minHit >= 10) newQueue.push(minHit - 10);
                if (maxHit < 90) newQueue.push(maxHit + 10);
            }
            // Add new targets to the front of the queue, keeping old ones as fallback
            robotHuntQueue = [...newQueue.filter(i => !robotShots.includes(i)), ...robotHuntQueue];
        }
        // --- END SMARTER AI LOGIC ---

    } else {
        // --- IT'S A MISS ---
        updates['host/misses'] = [...(myData.misses || []), shotIndex];
        updates['turn'] = 'host'; // Robot misses, player's turn
        if (gameMode === 'fantasy') { // Energy is now granted centrally in applyOfflineUpdates on turn change.
            // We only need to check for applying burn damage to the player.
            if (myData.burnEffect?.active) {
                applyBurn('host', myData, updates);
            }
        }
    }
    applyOfflineUpdates(updates);
}

function updateUAVPanel() {
    const myData = gameState[playerRole] || {};
    const statusPanel = document.getElementById('ship-status-panel');
    const statusContent = document.getElementById('ship-status-content');
    const currentRound = gameState.roundCount || 0;
    
    // The panel is always visible if the skill has been activated.
    if (!myData.uavActive) {
        statusPanel.classList.add('hidden');
        return;
    }
    statusPanel.classList.remove('hidden');

    // Only update the content on even-numbered rounds.
    if (currentRound % 2 === 0) {
        const report = getEnemyShipStatus();
        lastUAVReportHTML = report.map(ship => {
            const status = ship.remaining === 0 ? 'SUNK' : `${ship.remaining}/${ship.total}`;
            return `<div>${ship.name}: ${status}</div>`;
        }).join('');
    }

    // Always display the last known report.
    statusContent.innerHTML = lastUAVReportHTML || '<span>Scan data incoming...</span>';
}

function updateSkillsUI() {
    if (gameMode !== 'fantasy') return;

    const energyDisplay = document.getElementById('energy-display');
    const header = document.getElementById('skills-header');
    const attackBtn = document.getElementById('skill-attack-btn');
    const utilityBtn = document.getElementById('skill-utility-btn');
    const ultimateBtn = document.getElementById('skill-ultimate-btn');
    const debuffOverlay = document.getElementById('skill-debuff-overlay');
    
    const myData = gameState[playerRole] || {};
    const skillsAreDisabled = myData.skillsDisabled || false;
    const riftOnCooldown = playerFaction === 'mages' && myData.riftCooldown > 0;

    if (skillsAreDisabled) {
        debuffOverlay.classList.remove('hidden');
    } else {
        debuffOverlay.classList.add('hidden');
    }

    // Faction might not be set for opponent view, so default gracefully
    const factionName = playerFaction ? playerFaction.charAt(0).toUpperCase() + playerFaction.slice(1) : 'Player';
    let energyName = 'Energy';

    switch (playerFaction) {
        case 'military':
            energyName = 'Ammo';
            break;
        case 'mages':
            energyName = 'Mana';
            break;
        case 'vikings':
            energyName = 'Rage';
            break;
    }

    let skills = { attack: 'Attack', utility: 'Utility', ultimate: 'Ultimate' };
    switch (playerFaction) {
        case 'military':
            skills = { attack: 'Crossfire', utility: 'UAV Recon Drone', ultimate: 'Tactical Nuke' };
            break;
        case 'mages':
            skills = { attack: 'Fireball', utility: 'Temporal Rift', ultimate: 'Armageddon' };
            break;
        case 'vikings':
            skills = { attack: "Berserker's Sacrifice", utility: "Odin's Ravens", ultimate: "Jormungandr's Rage" }; // No change here
            break;
    }

    header.innerText = `${factionName} Skills`;
    energyDisplay.innerText = `${energyName}: ${playerEnergy}`;

    attackBtn.innerText = `${skills.attack} (${skillCosts.attack})`;
    utilityBtn.innerText = `${skills.utility} (${skillCosts.utility})`;

    // Special text for Viking Ult
    if (playerFaction === 'vikings' && activeSkill === 'ultimate') {
        let modeText = '';
        if (vikingUltMode === 'rows_and_cols') modeText = ' (Row & Col)';
        else if (vikingUltMode === 'two_rows') modeText = ' (2 Rows)';
        else if (vikingUltMode === 'two_cols') modeText = ' (2 Cols)';
        ultimateBtn.innerText = `${skills.ultimate}${modeText} (${skillCosts.ultimate})`;
    } else {
        ultimateBtn.innerText = `${skills.ultimate} (${skillCosts.ultimate})`;
    }

    attackBtn.disabled = skillsAreDisabled || playerEnergy < skillCosts.attack || !isMyTurn;
    utilityBtn.disabled = skillsAreDisabled || playerEnergy < skillCosts.utility || !isMyTurn || riftOnCooldown;
    ultimateBtn.disabled = skillsAreDisabled || playerEnergy < skillCosts.ultimate || !isMyTurn;

    // NEW: Visual for Mage cooldown
    if (riftOnCooldown) {
        utilityBtn.classList.add('on-cooldown');
        utilityBtn.dataset.cooldown = myData.riftCooldown;
    } else {
        utilityBtn.classList.remove('on-cooldown');
    }

}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    const enemyBoard = document.getElementById('enemy-board');

    indicator.innerText = isMyTurn ? "(YOUR TURN)" : "(ENEMY TURN)";
    indicator.style.color = isMyTurn ? "#00ff88" : "#ff4655";

    if (isMyTurn) {
        enemyBoard.classList.remove('disabled');
    } else {
        enemyBoard.classList.add('disabled');
        // Clear any active skill selection when it's not your turn
        activeSkill = null;
        document.querySelectorAll('#skills-panel button').forEach(b => b.classList.remove('active'));
    }
}

function checkGameOver() {
    if (isOfflineMode) {
        const myHits = document.querySelectorAll('#my-board .hit').length;
        const enemyHits = document.querySelectorAll('#enemy-board .hit').length;
        if (enemyHits === totalShipCells) showGameOver(true);
        else if (myHits === totalShipCells) showGameOver(false);
    } else if (gameState.host && gameState.guest) { // Online mode
        if (gameState.guest.hits?.length === totalShipCells) showGameOver(playerRole === 'host');
        else if (gameState.host.hits?.length === totalShipCells) showGameOver(playerRole === 'guest');
    }
}

function showGameOver(didIWin) {
    const panel = document.getElementById('game-over-panel');
    const msg = document.getElementById('game-over-message');
    panel.classList.remove('hidden');

    if (didIWin) {
        msg.innerText = "VICTORY!";
        msg.classList.add('win');
    } else {
        msg.innerText = "DEFEAT!";
        msg.classList.add('lose');
    }

    // Reveal Enemy Ships
    const enemyBoard = document.getElementById('enemy-board');
    opponentShips.forEach(index => {
        if (enemyBoard.children[index]) enemyBoard.children[index].classList.add('ship');
    });

    // Disable Boards
    enemyBoard.classList.add('disabled');
    document.getElementById('my-board').classList.add('disabled');
}
