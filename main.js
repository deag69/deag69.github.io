// main.js
// 

/* --- App-Status & globale Variablen (unverändert/erweitert) --- */
let allLogData = {};              // { filename: [ {round,...}, ... ] }
let allServerLogs = [];           // zusammengeführt
let logData = [];                 // aktives Spiel-Log
let currentRoundIndex = 0;

const GRID_SIZE = 7;
const GRID_CENTER = Math.floor(GRID_SIZE / 2);

let activeListForOverlay = null;
let currentDashboard = 'beasterDashboard'; // konsistent mit switchDashboard

/* DOM-Referenzen (werden nach Unlock gesetzt) */
let fileInput, serverLogInput, gridContainer, gridContainerModal, envGridDisplay;
let roundIndicator, prevRoundButton, nextRoundButton, timelineSlider;
let playPauseButton, playIcon, pauseIcon, fpsInput;
let zoomButton, zoomModal, modalRoundIndicator;
let serverLogsContainer, serverLogStatus, copyEnvButton;
let navBeaster, navWorld, beasterDashboard, worldDashboard;
let switchToWorld, switchToBeaster;
let fileCount, serverLogFileCount, fileDropdownContainer, fileSelector;

// ControlBar
let controlBarToggle, controlsInner;

// World-Dashboard DOM-Referenzen
let worldBeastList, worldSelectAll, worldBeastCount;
let worldGridContainer;
let serverLogsContainerWorld, serverLogStatusWorld;

let worldZoomSlider, worldZoomValue, worldScaleWrap;

/* --- World-Konstanten & State --- */
const WORLD_COLS = 71;
const WORLD_ROWS = 34;

const WORLD_X_MIN = -35, WORLD_X_MAX = 35;
const WORLD_Y_MIN = -17, WORLD_Y_MAX = 17;

// Für Achsen-Lables
const WORLD_Y_MIN_CELL = -17, WORLD_Y_MAX_CELL = 16;

let worldTrailSlider, worldTrailValue;
let worldTooltipEl, worldClickInfoEl;
let worldAxesBuilt = false;
let worldCellCoordCache = []; // index -> {row,col,x,y}

let beastColorMap = {};            // bid -> color
let arrowEnabledBeasts = new Set(); // bids mit Pfeil-Layer aktiv
let worldVisibilityMap = new Map(); // "x,y" -> Set(bid)

let worldLastRoundForLayers = -1;

/* NEU: feste Farbpalette (erste 6 BIDs) und Reihenfolge */
const WORLD_FIXED_PALETTE = [
    '#EF4444', '#3B82F6', '#10B981',
    '#F59E0B', '#D946EF', '#06B6D4'
];
const WORLD_FIXED_HUES = [0, 212, 158, 38, 292, 190];

let worldPriorityBids = []; // nach Auftritts-/Sortierreihenfolge
let __currentBidContext = null; // für localCharToColor('B') im World-Env

/* --- Clipboard Helper (unverändert) --- */
function copyText(text, buttonEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (buttonEl) {
                const old = buttonEl.textContent;
                buttonEl.textContent = 'Kopiert!';
                setTimeout(() => { buttonEl.textContent = old; }, 1200);
            }
        }).catch(() => { fallbackCopy(text, buttonEl); });
    } else {
        fallbackCopy(text, buttonEl);
    }
}

function fallbackCopy(text, buttonEl) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        document.execCommand('copy');
        if (buttonEl) {
            const old = buttonEl.textContent;
            buttonEl.textContent = 'Kopiert!';
            setTimeout(() => { buttonEl.textContent = old; }, 1200);
        }
    } catch (err) {
        console.error('Copy failed', err);
    }
    document.body.removeChild(textarea);
}

/* --- Hilfsfunktionen / Rendering (unverändert Biester) --- */
function coordsToStringIndex(x, y) {
    const rowIndex = y + GRID_CENTER;
    const colIndex = x + GRID_CENTER;
    return rowIndex * GRID_SIZE + colIndex;
}

function coordsToPercent(x, y) {
    const left = (x + GRID_CENTER + 0.5) * (100 / GRID_SIZE);
    const top = (y + GRID_CENTER + 0.5) * (100 / GRID_SIZE);
    return { left, top };
}

function formatCoordsListHTML(list, basePriority, nextMove, title) {
    if (!list || list.length === 0) return '[]';

    const items = list.map((c, i) => {
        const priority = basePriority - i;
        const coordString = `[${c.join(', ')}]`;
        const isNext =
            nextMove &&
            c.length === 2 &&
            c[0] === nextMove[0] &&
            c[1] === nextMove[1];

        const text = `(${priority}) ${coordString}`;
        return isNext
            ? `<span class="text-move-pink font-bold border-b-2 border-move-pink">${text}</span>`
            : text;
    });

    // NEU: immer vollständige Liste im Panel anzeigen (kein Popup/Knopf)
    return items.join(', ');
}

function createGridCells(data, container, isModal) {
    container.innerHTML = '';

    const env = data.env || ''.padEnd(49, '.');

    for (let y = -GRID_CENTER; y <= GRID_CENTER; y++) {
        for (let x = -GRID_CENTER; x <= GRID_CENTER; x++) {

            const index = coordsToStringIndex(x, y);
            const cellChar = env[index] || '.';
            const isAgent = x === 0 && y === 0;

            let cellColor = isModal ? 'bg-gray-200' : 'bg-grid-light';
            let content = '';

            if (cellChar === '*') {
                cellColor = 'bg-food-orange';
                content = 'F';
            } else if (cellChar === '>' || cellChar === '=') {
                cellColor = 'bg-enemy-red';
                content = 'E';
            } else if (cellChar === '<') {
                cellColor = 'bg-enemy-green';
                content = 'e';
            } else {
                cellColor = 'bg-gray-200';
            }

            if (isAgent) {
                cellColor = 'bg-agent-blue';
                content = 'B';
            }

            const cellDiv = document.createElement('div');
            cellDiv.className = `grid-cell ${cellColor} font-bold text-white text-xs shadow-inner`;
            if (isModal) cellDiv.classList.add('text-lg');

            cellDiv.innerHTML = `<span class="absolute">${content}</span>`;
            cellDiv.dataset.coord = `${x},${y}`;

            container.appendChild(cellDiv);
        }
    }
}

function drawNextMoveRing(container, data) {
    const existing = container.querySelector('.next-move-overlay');
    if (existing) existing.remove();

    const mv = (data.move && data.move.length === 2) ? data.move : null;
    if (!mv) return;

    const [x, y] = mv;
    if (x < -GRID_CENTER || x > GRID_CENTER || y < -GRID_CENTER || y > GRID_CENTER)
        return;

    const { left, top } = coordsToPercent(x, y);
    const ring = document.createElement('div');
    ring.className = 'next-move-overlay';
    ring.style.left = `${left}%`;
    ring.style.top = `${top}%`;

    container.appendChild(ring);
}

function renderGrid(data) {
    createGridCells(data, gridContainer, false);
    ensureMoveAreaDiv();
    placeMoveArea();
    drawNextMoveRing(gridContainer, data);

    if (zoomModal && zoomModal.style.display === 'flex') {
        updateModalContent(logData[currentRoundIndex]);
    }
}

function renderEnvGrid(envString) {
    envGridDisplay.innerHTML = '';

    if (!envString) envString = '.'.repeat(49);

    for (let i = 0; i < envString.length; i++) {
        const char = envString[i];
        const cellDiv = document.createElement('div');

        cellDiv.textContent = char;

        let cellClass =
            'p-1 aspect-square bg-gray-200 rounded-sm flex items-center justify-center font-mono';

        if (char === '*') cellClass += ' text-food-orange font-bold';
        else if (char === '>' || char === '=') cellClass += ' text-enemy-red font-bold';
        else if (char === '<') cellClass += ' text-enemy-green font-bold';
        else if (i === coordsToStringIndex(0, 0)) cellClass += ' text-agent-blue font-bold';

        cellDiv.className = cellClass;
        envGridDisplay.appendChild(cellDiv);
    }
}
function renderInfo(data) {
    if (!data) data = {};

    document.getElementById('infoRound').textContent = data.round ?? 'N/A';
    document.getElementById('infoEvent').textContent = data.event ?? 'N/A';
    document.getElementById('infoBid').textContent = data.bid ?? 'N/A';
    document.getElementById('infoEnerg').textContent =
        (typeof data.energ === 'number') ? data.energ.toFixed(2) : (data.energ ?? 'N/A');

    document.getElementById('infoMove').textContent =
        data.move ? `[${data.move.join(', ')}]` : 'N/A';

    const isAbsPosAvailable = data.abs_x !== undefined && data.abs_y !== undefined;
    const currentAbsCoordsEl = document.getElementById('infoCurrentAbsCoords');
    currentAbsCoordsEl.textContent = isAbsPosAvailable
        ? `[${data.abs_x}, ${data.abs_y}]`
        : 'N/A';

    const targetAbsCoordsEl = document.getElementById('infoTargetAbsCoords');
    if (data.move && data.move.length === 2 && isAbsPosAvailable) {
        const absX = data.abs_x + data.move[0];
        const absY = data.abs_y + data.move[1];
        targetAbsCoordsEl.textContent = `[${absX}, ${absY}]`;
    } else {
        targetAbsCoordsEl.textContent = 'N/A';
    }

    const prioFood = parseInt(data.priorityfood) || 0;
    const prioHunt = parseInt(data.priorityhunt) || 0;
    const prioEscape = parseInt(data.priorityescape) || 0;

    document.getElementById('prioFood').textContent = prioFood;
    document.getElementById('prioHunt').textContent = prioHunt;
    document.getElementById('prioEscape').textContent = prioEscape;

    const nextMove = (data.move && data.move.length === 2) ? data.move : null;

    document.getElementById('listFoodCoords').innerHTML =
        formatCoordsListHTML(data.foodlist, prioFood, nextMove, 'Futter-Liste');

    document.getElementById('listHuntCoords').innerHTML =
        formatCoordsListHTML(data.huntlist, prioHunt, nextMove, 'Jagd-Liste');

    document.getElementById('listEscapeCoords').innerHTML =
        formatCoordsListHTML(data.escapelist, prioEscape, nextMove, 'Flucht-Liste');
}

/* --- Playback --- */
function togglePlayback(shouldPlay = !isPlaying) {
    isPlaying = shouldPlay;

    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }

    if (!logData || logData.length === 0) {
        isPlaying = false;
        pauseIcon.classList.add('hidden');
        playIcon.classList.remove('hidden');

        playPauseButton.classList.remove('bg-move-pink', 'hover:bg-pink-600');
        playPauseButton.classList.add('bg-agent-blue', 'hover:bg-blue-600');
        return;
    }

    if (isPlaying) {
        if (currentRoundIndex >= logData.length - 1) goToRound(0);

        const fps = parseInt(fpsInput.value) || 4;
        const intervalMs = 1000 / fps;

        playbackInterval = setInterval(() => {
            if (currentRoundIndex < logData.length - 1) {
                goToRound(currentRoundIndex + 1);
            } else {
                togglePlayback(false);
            }
        }, intervalMs);

        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');

        playPauseButton.classList.remove('bg-agent-blue', 'hover:bg-blue-600');
        playPauseButton.classList.add('bg-move-pink', 'hover:bg-pink-600');

    } else {
        pauseIcon.classList.add('hidden');
        playIcon.classList.remove('hidden');

        playPauseButton.classList.remove('bg-move-pink', 'hover:bg-pink-600');
        playPauseButton.classList.add('bg-agent-blue', 'hover:bg-blue-600');
    }
}

/* --- Move-Area (5x5) --- */
function ensureMoveAreaDiv() {
    let area = document.getElementById('moveAreaDiv');
    if (!area) {
        area = document.createElement('div');
        area.id = 'moveAreaDiv';
        area.className = 'move-area';
        gridContainer.appendChild(area);
    }
}

function placeMoveArea() {
    const x0 = -2, y0 = -2, x1 = 2, y1 = 2;

    const leftPercent = (x0 + GRID_CENTER) * (100 / GRID_SIZE) + (100 / GRID_SIZE) * 0.02;
    const topPercent = (y0 + GRID_CENTER) * (100 / GRID_SIZE) + (100 / GRID_SIZE) * 0.02;

    const widthPct = (x1 - x0 + 1) * (100 / GRID_SIZE) - (100 / GRID_SIZE) * 0.04;
    const heightPct = (y1 - y0 + 1) * (100 / GRID_SIZE) - (100 / GRID_SIZE) * 0.04;

    const area = document.getElementById('moveAreaDiv');
    if (area) {
        area.style.left = `${leftPercent}%`;
        area.style.top = `${topPercent}%`;
        area.style.width = `${widthPct}%`;
        area.style.height = `${heightPct}%`;
    }
}

/* --- Listen-Overlay (Kreise) --- */
function buildOverlayForContainer(container, listName, list, basePriority) {
    if (!container) return;

    // vorherige Overlays entfernen
    container.querySelectorAll('.overlay').forEach(el => el.remove());

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'overlay rounded-lg';
    overlayDiv.id = 'listOverlay';

    let pointColor = '';
    if (listName === 'foodlist') pointColor = 'bg-food-orange';
    else if (listName === 'huntlist') pointColor = 'bg-enemy-red';
    else if (listName === 'escapelist') pointColor = 'bg-move-pink';

    list.forEach((coords, i) => {
        if (!coords || coords.length !== 2) return;

        const [x, y] = coords;

        if (x < -GRID_CENTER || x > GRID_CENTER || y < -GRID_CENTER || y > GRID_CENTER)
            return;

        const { left, top } = coordsToPercent(x, y);

        const pointDiv = document.createElement('div');
        pointDiv.className = `overlay-point ${pointColor}`;
        pointDiv.style.left = `${left}%`;
        pointDiv.style.top = `${top}%`;

        const priorityValue = basePriority - i;
        pointDiv.textContent = priorityValue;

        overlayDiv.appendChild(pointDiv);
    });

    container.appendChild(overlayDiv);
}

function showListOverlay(listName) {
    activeListForOverlay = listName;

    if (!logData || !logData[currentRoundIndex]) return;

    const currentData = logData[currentRoundIndex];
    const list = currentData[listName] || [];

    const basePriorityKey = 'priority' + listName.replace('list', '');
    const basePriority = parseInt(currentData[basePriorityKey]) || 0;

    // In BEIDEN Grids rendern (Panel + Modal)
    buildOverlayForContainer(gridContainer, listName, list, basePriority);
    buildOverlayForContainer(gridContainerModal, listName, list, basePriority);
}

function hideOverlay() {
    activeListForOverlay = null;

    if (gridContainer)
        gridContainer.querySelectorAll('.overlay').forEach(el => el.remove());

    if (gridContainerModal)
        gridContainerModal.querySelectorAll('.overlay').forEach(el => el.remove());
}

/* --- Modals --- */
function updateModalContent(data) {
    createGridCells(data, gridContainerModal, true);

    if (activeListForOverlay)
        showListOverlay(activeListForOverlay);

    drawNextMoveRing(gridContainerModal, data);

    const maxRound =
        (logData && logData.length > 0) ? logData[logData.length - 1].round : 0;

    modalRoundIndicator.textContent = `Runde ${data.round} / ${maxRound}`;
}

function openModal() {
    if (logData.length === 0 || !zoomModal) return;

    zoomModal.style.display = 'flex';
    updateModalContent(logData[currentRoundIndex]);
}

function closeModal(event) {
    if (!zoomModal) return;

    if (!event || event.target === zoomModal) {
        zoomModal.style.display = 'none';

        if (activeListForOverlay) {
            const tmp = activeListForOverlay;
            hideOverlay();
            showListOverlay(tmp);
        }
    }
}

function showFullListModal(title, list, basePriority) {
    // bleibt ungenutzt (Popup entfernt)
    const titleEl = document.getElementById('listModalTitle');
    const contentEl = document.getElementById('listModalContent');

    titleEl.textContent = title;

    if (!list || list.length === 0) {
        contentEl.innerHTML = '<div class="text-gray-500">(leer)</div>';
    } else {
        const currentData = (logData && logData[currentRoundIndex])
            ? logData[currentRoundIndex]
            : {};

        const mv = (currentData.move && currentData.move.length === 2)
            ? currentData.move
            : null;

        const html = list.map((c, i) => {
            const prio = basePriority - i;
            const isNext = mv && c[0] === mv[0] && c[1] === mv[1];
            const cls = isNext
                ? 'text-move-pink font-bold border-b-2 border-move-pink'
                : '';
            return `<div class="${cls}">(${prio}) [${c[0]}, ${c[1]}]</div>`;
        }).join('');

        contentEl.innerHTML = html;
    }

    document.getElementById('listModal').style.display = 'flex';
}

function closeListModal(event) {
    const listModal = document.getElementById('listModal');
    if (!listModal) return;

    if (!event || event.target === listModal)
        listModal.style.display = 'none';
}
/* --- Dashboard-Navigation (unverändert) --- */
function switchDashboard(dashboardId) {
    if (dashboardId === currentDashboard) return;

    document.querySelectorAll('.dashboard-page')
        .forEach(page => page.classList.remove('active'));

    navBeaster.classList.remove('active');
    navWorld.classList.remove('active');

    if (dashboardId === 'worldDashboard') {
        worldDashboard.classList.add('active');
        navWorld.classList.add('active');
        currentDashboard = 'worldDashboard';
    } else {
        beasterDashboard.classList.add('active');
        navBeaster.classList.add('active');
        currentDashboard = 'beasterDashboard';
    }
}

/* --- Rundennavigation --- */
function goToRound(index) {
    if (!logData || logData.length === 0) {
        resetUIForNoData();
        return;
    }

    if (index >= 0 && index < logData.length) {
        currentRoundIndex = index;
        const currentData = logData[currentRoundIndex];
        if (!currentData) return;

        const maxRound = logData[logData.length - 1].round;

        roundIndicator.textContent = `Runde ${currentData.round} / ${maxRound}`;
        if (modalRoundIndicator)
            modalRoundIndicator.textContent = `Runde ${currentData.round} / ${maxRound}`;

        timelineSlider.value = index;

        renderGrid(currentData);
        renderInfo(currentData);
        renderEnvGrid(currentData.env);

        prevRoundButton.disabled = currentRoundIndex === 0;
        nextRoundButton.disabled = currentRoundIndex === logData.length - 1;

        hideOverlay();
        if (activeListForOverlay) showListOverlay(activeListForOverlay);

        renderServerLogsForRound(currentData.round);
        renderServerLogsForRoundWorld(currentData.round);
    }
}

function resetUIForNoData() {
    logData = [];
    currentRoundIndex = 0;

    timelineSlider.max = 0;
    timelineSlider.value = 0;
    timelineSlider.disabled = true;

    playPauseButton.disabled = true;
    zoomButton.disabled = true;
    prevRoundButton.disabled = true;
    nextRoundButton.disabled = true;

    roundIndicator.textContent = "Runde 0 / 0";

    renderEmptyGrid();
    renderInfo(null);
    renderEnvGrid(null);

    renderServerLogsForRound(null);
    renderServerLogsForRoundWorld(null);

    clearWorldLayers();
}

/* --- Parser --- */
function parseNDJSONContentToArray(text) {
    const lines = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const arr = [];

    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            arr.push(obj);
        } catch (e) {
            /* ignore invalid lines */
        }
    }
    return arr;
}

/* --- Server-Logs: Biester-Dashboard --- */
function renderServerLogsForRound(roundNumber) {
    serverLogsContainer.innerHTML = '';

    if (!allServerLogs || allServerLogs.length === 0) {
        serverLogsContainer.innerHTML =
            '<div class="text-gray-400">Keine Server-Logs verfügbar.</div>';
        serverLogStatus.textContent = 'keine Logs';
        return;
    }

    if (roundNumber == null) {
        allServerLogs.forEach(entry => {
            const wrapper = document.createElement('div');
            wrapper.className = 'p-2 border rounded-md bg-gray-50';

            const timeStr = entry.time
                ? `<div class="text-xs text-gray-400">Zeit: ${entry.time}</div>`
                : '';

            wrapper.innerHTML = `
                <div class="font-semibold text-sm text-gray-800">Round ${entry.round}</div>
                ${timeStr}
                <div class="text-sm text-gray-700 mt-1">
                    ${escapeHtml(entry.servermsg || '')}
                </div>
                ${entry.exception
                    ? `<div class="text-xs text-red-600 mt-1 font-mono">
                        ${escapeHtml(entry.exception)}
                       </div>`
                    : ''}
            `;

            serverLogsContainer.appendChild(wrapper);
        });

        serverLogStatus.textContent = `${allServerLogs.length} Einträge gesamt`;
        return;
    }

    const filtered = allServerLogs.filter(
        l => parseInt(l.round) === parseInt(roundNumber)
    );

    if (filtered.length === 0) {
        serverLogsContainer.innerHTML =
            `<div class="text-gray-500">Keine Logs für Runde ${roundNumber}.</div>`;
        serverLogStatus.textContent = `runde ${roundNumber}: 0 Einträge`;
        return;
    }

    filtered.forEach(entry => {
        const wrapper = document.createElement('div');
        wrapper.className = 'p-2 border rounded-md bg-gray-50';

        const timeStr = entry.time
            ? `<div class="text-xs text-gray-400">Zeit: ${entry.time}</div>`
            : '';

        wrapper.innerHTML = `
            <div class="font-semibold text-sm text-gray-800">Round ${entry.round}</div>
            ${timeStr}
            <div class="text-sm text-gray-700 mt-1">${escapeHtml(entry.servermsg || '')}</div>
            ${entry.exception
                ? `<div class="text-xs text-red-600 mt-1 font-mono">${escapeHtml(entry.exception)}</div>`
                : ''}
        `;

        serverLogsContainer.appendChild(wrapper);
    });

    serverLogStatus.textContent =
        `runde ${roundNumber}: ${filtered.length} Einträge`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]
    ));
}

/* --- Helper --- */
function triggerListButton(listName) {
    const button = document.querySelector(`.eye-icon[data-list="${listName}"]`);
    if (button) button.click();
}

function renderEmptyGrid() {
    const dummy = {
        env: '.'.repeat(49),
        round: 0,
        event: '',
        bid: '',
        energ: 0,
        move: null,
        foodlist: [],
        huntlist: [],
        escapelist: [],
        priorityfood: 0,
        priorityhunt: 0,
        priorityescape: 0
    };

    createGridCells(dummy, gridContainer, false);
    ensureMoveAreaDiv();
    placeMoveArea();
}

/* --- Datei-Verwaltung: Loader --- */
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function updateFileSelector() {
    const fileNames = Object.keys(allLogData);
    fileSelector.innerHTML = '';

    if (fileNames.length > 1) {
        fileDropdownContainer.classList.remove('hidden');
        fileNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            fileSelector.appendChild(option);
        });
    } else {
        fileDropdownContainer.classList.add('hidden');
    }
}

function selectActiveFile(fileName) {
    if (!fileName || !allLogData[fileName]) {
        resetUIForNoData();
        return;
    }

    logData = allLogData[fileName];

    if (fileSelector.value !== fileName)
        fileSelector.value = fileName;

    if (logData.length > 0) {
        timelineSlider.max = logData.length - 1;
        timelineSlider.disabled = false;

        playPauseButton.disabled = false;
        zoomButton.disabled = false;

        const maxRound = logData[logData.length - 1].round;
        roundIndicator.textContent =
            `Runde ${logData[0].round} / ${maxRound}`;

        goToRound(0);
    } else {
        resetUIForNoData();
    }
}
/* --- World Dashboard – Beast IDs & Grid & Logs (ERWEITERT NUR HIER) --- */
function updateBeastIdListWorld() {
    if (!worldBeastList) return;

    // Ersten Auftritt pro BID sammeln
    const earliest = new Map();
    const idsAll = new Set();

    const names = Object.keys(allLogData || {});
    names.forEach(name => {
        const arr = allLogData[name] || [];
        arr.forEach(row => {
            const bid = (row && row.bid != null) ? String(row.bid).trim() : '';
            if (!bid) return;

            idsAll.add(bid);

            const r = parseInt(row.round);
            if (!Number.isFinite(r)) return;

            if (!earliest.has(bid) || r < earliest.get(bid))
                earliest.set(bid, r);
        });
    });

    // Reihenfolge: nach erstem Auftreten, dann numerisch/lex
    const orderedIds = Array.from(idsAll).sort((a, b) => {
        const ra = earliest.get(a) ?? Infinity;
        const rb = earliest.get(b) ?? Infinity;

        if (ra !== rb) return ra - rb;
        return a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
    });

    worldPriorityBids = orderedIds.slice();

    // Feste Palette für die ersten 6
    for (let i = 0; i < Math.min(6, worldPriorityBids.length); i++) {
        const bid = worldPriorityBids[i];
        beastColorMap[bid] = WORLD_FIXED_PALETTE[i];
    }

    // DOM aufbauen
    worldBeastList.innerHTML = '';
    if (orderedIds.length === 0) {
        worldBeastList.innerHTML = '<div class="text-gray-400">Keine Biester gefunden.</div>';
        if (worldBeastCount) worldBeastCount.textContent = '0';
        return;
    }

    orderedIds.forEach(id => {
        const color = getBeastColor(id);
        const row = document.createElement('label');
        row.className = 'beast-row';

        row.innerHTML = `
            <div class="flex items-center gap-2">
                <button type="button" class="beast-swatch"
                        data-bid="${escapeHtml(id)}"
                        title="Pfeil-Layer umschalten"
                        style="background:${color}"></button>
                <span class="font-mono text-sm">${escapeHtml(id)}</span>
            </div>
            <input type="checkbox" class="world-bid-checkbox"
                   data-bid="${escapeHtml(id)}" checked>
        `;

        worldBeastList.appendChild(row);
    });

    if (worldBeastCount) worldBeastCount.textContent = String(orderedIds.length);

    // Checkbox + Swatch Events
    worldBeastList.addEventListener('change', e => {
        if (e.target && e.target.classList.contains('world-bid-checkbox'))
            renderWorldVisualization();
    });

    worldBeastList.addEventListener('click', e => {
        const btn = e.target.closest('.beast-swatch');
        if (!btn) return;

        const bid = btn.getAttribute('data-bid');

        if (arrowEnabledBeasts.has(bid)) {
            arrowEnabledBeasts.delete(bid);
            btn.classList.remove('active');
        } else {
            arrowEnabledBeasts.add(bid);
            btn.classList.add('active');
        }
        renderWorldVisualization();
    });
}

/* --- Grid 71×34 (Weltkarte) --- */
function buildWorldGrid71x34() {
    if (!worldGridContainer) return;

    worldGridContainer.innerHTML = '';

    worldCellCoordCache = [];
    const rows = WORLD_ROWS;
    const cols = WORLD_COLS;

    // Zellen erzeugen
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'world-grid-cell';
            worldGridContainer.appendChild(cell);

            const x = c - Math.floor(cols / 2);
            const y = r - Math.floor(rows / 2);

            worldCellCoordCache.push({ row: r, col: c, x, y });
        }
    }

    // Zentrum markieren
    const centerRow = Math.floor(rows / 2);
    const centerCol = Math.floor(cols / 2);
    const idx = centerRow * cols + centerCol;

    const cells = worldGridContainer.querySelectorAll('.world-grid-cell');
    if (cells[idx])
        cells[idx].style.boxShadow = 'inset 0 0 0 2px #ffffff';

    ensureWorldLayers();

    // Tooltip + Click-Info
    if (!worldTooltipEl) {
        worldTooltipEl = document.createElement('div');
        worldTooltipEl.className = 'world-tooltip hidden';
        worldTooltipEl.id = 'worldTooltip';
        worldTooltipEl.textContent = '(0,0)';
        worldGridContainer.appendChild(worldTooltipEl);
    }

    if (!worldClickInfoEl) {
        worldClickInfoEl = document.createElement('div');
        worldClickInfoEl.className = 'world-click-info hidden';
        worldClickInfoEl.id = 'worldClickInfo';
        worldGridContainer.appendChild(worldClickInfoEl);
    }

    // Maus-Ereignisse
    worldGridContainer.addEventListener('mousemove', onWorldMouseMove);
    worldGridContainer.addEventListener('mouseleave', () => {
        if (worldTooltipEl) worldTooltipEl.classList.add('hidden');
    });

    worldGridContainer.addEventListener('click', onWorldGridClick);

    // Achsen 1× erstellen
    if (!worldAxesBuilt) {
        buildWorldAxes();
        worldAxesBuilt = true;
    }

    // NEU: an Containerbreite/-höhe anpassen
    fitWorldGridToWrapper();
}

/* --- Server-Logs im World Dashboard --- */
function renderServerLogsForRoundWorld(roundNumber) {
    if (!serverLogsContainerWorld || !serverLogStatusWorld) return;

    serverLogsContainerWorld.innerHTML = '';

    if (!allServerLogs || allServerLogs.length === 0) {
        serverLogsContainerWorld.innerHTML =
            '<div class="text-gray-400">Keine Server-Logs verfügbar.</div>';
        serverLogStatusWorld.textContent = 'keine Logs';
        return;
    }

    if (roundNumber == null) {
        allServerLogs.forEach(entry => {
            const wrapper = document.createElement('div');
            wrapper.className = 'p-2 border rounded-md bg-gray-50';

            const timeStr = entry.time
                ? `<div class="text-xs text-gray-400">Zeit: ${entry.time}</div>`
                : '';

            wrapper.innerHTML = `
                <div class="font-semibold text-sm text-gray-800">Round ${entry.round}</div>
                ${timeStr}
                <div class="text-sm text-gray-700 mt-1">${escapeHtml(entry.servermsg || '')}</div>
                ${entry.exception
                    ? `<div class="text-xs text-red-600 mt-1 font-mono">${escapeHtml(entry.exception)}</div>`
                    : ''}
            `;

            serverLogsContainerWorld.appendChild(wrapper);
        });

        serverLogStatusWorld.textContent = `${allServerLogs.length} Einträge gesamt`;
        return;
    }

    const filtered = allServerLogs.filter(
        l => parseInt(l.round) === parseInt(roundNumber)
    );

    if (filtered.length === 0) {
        serverLogsContainerWorld.innerHTML =
            `<div class="text-gray-500">Keine Logs für Runde ${roundNumber}.</div>`;
        serverLogStatusWorld.textContent = `runde ${roundNumber}: 0 Einträge`;
        return;
    }

    filtered.forEach(entry => {
        const wrapper = document.createElement('div');
        wrapper.className = 'p-2 border rounded-md bg-gray-50';

        const timeStr = entry.time
            ? `<div class="text-xs text-gray-400">Zeit: ${entry.time}</div>`
            : '';

        wrapper.innerHTML = `
            <div class="font-semibold text-sm text-gray-800">Round ${entry.round}</div>
            ${timeStr}
            <div class="text-sm text-gray-700 mt-1">${escapeHtml(entry.servermsg || '')}</div>
            ${entry.exception
                ? `<div class="text-xs text-red-600 mt-1 font-mono">${escapeHtml(entry.exception)}</div>`
                : ''}
        `;

        serverLogsContainerWorld.appendChild(wrapper);
    });

    serverLogStatusWorld.textContent = `runde ${roundNumber}: ${filtered.length} Einträge`;
}

/* --- World Layers erstellen --- */
function ensureWorldLayers() {
    if (!worldGridContainer) return;

    const ensure = (id, cls, isSvg = false) => {
        if (!worldGridContainer.querySelector(id)) {
            if (isSvg) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('id', id.substring(1));
                svg.setAttribute('class', cls);
                svg.setAttribute('viewBox', `0 0 ${WORLD_COLS} ${WORLD_ROWS}`);
                svg.setAttribute('preserveAspectRatio', 'none');
                worldGridContainer.appendChild(svg);
            } else {
                const div = document.createElement('div');
                div.className = cls;
                div.id = id.substring(1);
                worldGridContainer.appendChild(div);
            }
        }
    };

    ensure('#worldTrailLayer', 'world-layer trails');
    ensure('#worldSeenLayer', 'world-layer seen'); // NEU: Fading-Layer
    ensure('#worldEnvLayer', 'world-layer env');
    ensure('#worldDotsLayer', 'world-layer dots');
    ensure('#worldArrowLayer', 'world-layer arrows', true);
    ensure('#worldAxisLayer', 'world-layer axes');
    ensure('#worldMoveAreaLayer', 'world-layer moveArea');
    ensure('#worldMoveTargetLayer', 'world-layer moveTarget');
}

function clearWorldLayers() {
    if (!worldGridContainer) return;

    const ids = [
        '#worldTrailLayer',
        '#worldSeenLayer',
        '#worldEnvLayer',
        '#worldDotsLayer',
        '#worldArrowLayer',
        '#worldAxisLayer',
        '#worldMoveAreaLayer',
        '#worldMoveTargetLayer'
    ];

    ids.forEach(sel => {
        const el = worldGridContainer.querySelector(sel);
        if (!el) return;
        el.innerHTML = '';
    });

    const cells = worldGridContainer.querySelectorAll('.world-grid-cell');
    cells.forEach(c => c.style.background = 'var(--world-undiscovered)');

    worldVisibilityMap.clear();

    if (worldClickInfoEl) {
        worldClickInfoEl.classList.add('hidden');
        worldClickInfoEl.textContent = '';
    }
}

/* --- Achsen-Layer --- */
function buildWorldAxes() {
    ensureWorldLayers();

    const axis = worldGridContainer.querySelector('#worldAxisLayer');
    if (!axis) return;

    axis.innerHTML = '';

    // X-Achse labels
    for (let vx = -35; vx <= 35; vx += 5) {
        const pct = ((vx + 35) / 70) * 100;

        const top = document.createElement('div');
        top.className = 'axis-label';
        top.textContent = String(vx);
        top.style.left = pct + '%';
        top.style.top = '-12px';
        axis.appendChild(top);

        const bottom = document.createElement('div');
        bottom.className = 'axis-label';
        bottom.textContent = String(vx);
        bottom.style.left = pct + '%';
        bottom.style.top = 'calc(100% + 12px)';
        axis.appendChild(bottom);
    }

    // Y-Achse labels
    for (let vy = -17; vy <= 17; vy += 5) {
        const pct = ((vy + 17) / 34) * 100;

        const left = document.createElement('div');
        left.className = 'axis-label y';
        left.textContent = String(vy);
        left.style.left = '-12px';
        left.style.top = pct + '%';
        axis.appendChild(left);

        const right = document.createElement('div');
        right.className = 'axis-label';
        right.textContent = String(vy);
        right.style.left = 'calc(100% + 12px)';
        right.style.top = pct + '%';
        axis.appendChild(right);
    }
}
function getSelectedBeastIds() {
    if (!worldBeastList) return [];
    return Array.from(worldBeastList.querySelectorAll('.world-bid-checkbox'))
        .filter(cb => cb.checked)
        .map(cb => String(cb.getAttribute('data-bid')));
}

/* Farbe generieren gemäß Vorgabe */
function getBeastColor(bid) {
    // Feste Palette für die ersten 6 unterschiedlichen BIDs nach worldPriorityBids
    const idx = worldPriorityBids.indexOf(String(bid));
    if (idx !== -1 && idx < 6) {
        const fixed = WORLD_FIXED_PALETTE[idx];
        beastColorMap[bid] = fixed;
        return fixed;
    }

    if (beastColorMap[bid]) return beastColorMap[bid];

    // Fallback: gehashte HSL, aber Mindestabstand 20° zu den sechs Primärfarben
    let h = 0;
    const s = 80, l = 45;
    const str = String(bid);

    for (let i = 0; i < str.length; i++)
        h = (h * 31 + str.charCodeAt(i)) % 360;

    const hueDist = (a, b) => {
        let d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    };

    while (WORLD_FIXED_HUES.some(base => hueDist(h, base) < 20)) {
        h = (h + 23) % 360; // versetzen, bis Abstand passt
    }

    const color = `hsl(${h} ${s}% ${l}%)`;
    beastColorMap[bid] = color;
    return color;
}

function onWorldMouseMove(e) {
    const rect = worldGridContainer.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;

    // auf Zelle runden
    const col = Math.min(WORLD_COLS - 1, Math.max(0, Math.floor(xPct * WORLD_COLS)));
    const row = Math.min(WORLD_ROWS - 1, Math.max(0, Math.floor(yPct * WORLD_ROWS)));

    const x = col - Math.floor(WORLD_COLS / 2);
    const y = row - Math.floor(WORLD_ROWS / 2);

    if (!worldTooltipEl) return;

    worldTooltipEl.textContent = `(${x}, ${y})`;
    worldTooltipEl.style.left = ((col + 0.5) * (100 / WORLD_COLS)) + '%';
    worldTooltipEl.style.top = ((row + 0.5) * (100 / WORLD_ROWS)) + '%';
    worldTooltipEl.classList.remove('hidden');
}

function onWorldGridClick(e) {
    const rect = worldGridContainer.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;

    const col = Math.min(WORLD_COLS - 1, Math.max(0, Math.floor(xPct * WORLD_COLS)));
    const row = Math.min(WORLD_ROWS - 1, Math.max(0, Math.floor(yPct * WORLD_ROWS)));

    const x = col - Math.floor(WORLD_COLS / 2);
    const y = row - Math.floor(WORLD_ROWS / 2);

    const key = `${x},${y}`;
    const set = worldVisibilityMap.get(key);

    let text = '';
    if (!set || set.size === 0)
        text = `Dieses Feld (${key}) wird gesehen von: <b>Niemand</b>`;
    else
        text = `Dieses Feld (${key}) wird gesehen von: <b>${Array.from(set).join(', ')}</b>`;

    if (worldClickInfoEl) {
        worldClickInfoEl.innerHTML = text;
        worldClickInfoEl.classList.remove('hidden');
    }
}

function findBeastEntryAtRound(bid, round) {
    if (round == null) return null;

    const names = Object.keys(allLogData || {});
    for (const name of names) {
        const arr = allLogData[name] || [];
        const item = arr.find(
            r => String(r.bid) === String(bid) &&
                parseInt(r.round) === parseInt(round)
        );
        if (item) return item;
    }
    return null;
}

function getBeastHistory(bid, upToRound, N) {
    const result = [];
    const names = Object.keys(allLogData || {});

    for (const name of names) {
        const arr = allLogData[name] || [];
        arr.forEach(r => {
            if (String(r.bid) === String(bid) &&
                r.abs_x !== undefined &&
                r.abs_y !== undefined) {

                if (upToRound == null || parseInt(r.round) <= parseInt(upToRound))
                    result.push(r);
            }
        });
    }

    result.sort((a, b) => parseInt(a.round) - parseInt(b.round));
    if (N == null) return result;

    return result.slice(Math.max(0, result.length - N));
}

function indexToLocalXY(i) {
    // 0..48 -> [-3..3],[-3..3]
    const y = Math.floor(i / GRID_SIZE) - GRID_CENTER;
    const x = (i % GRID_SIZE) - GRID_CENTER;
    return { x, y };
}

function localCharToColor(ch, isCenter = false) {
    if (isCenter) {
        // im World-Env die BID-Farbe verwenden (Konsistenz)
        if (__currentBidContext != null) return getBeastColor(__currentBidContext);
        return 'var(--agent-blue, #3B82F6)';
    }

    if (ch === '*') return '#F97316';
    if (ch === '<') return '#10B981';
    if (ch === '>' || ch === '=') return '#EF4444';
    return null;
}

/* NEU: Vertikales Wrap statt Clamping */
function clampWorldY(y) {
    const range = (WORLD_Y_MAX_CELL - WORLD_Y_MIN_CELL + 1); // 34
    let v = y;
    // auf Bereich [-17..16] abbilden (toroidisch)
    v = ((v - WORLD_Y_MIN_CELL) % range + range) % range + WORLD_Y_MIN_CELL;
    return v;
}

/* --- Sicht, Trails, Dots, Pfeile usw. --- */
function renderWorldVisualization() {
    if (!worldGridContainer) return;

    ensureWorldLayers();

    const trailLayer = worldGridContainer.querySelector('#worldTrailLayer');
    const seenLayer = worldGridContainer.querySelector('#worldSeenLayer');
    const envLayer = worldGridContainer.querySelector('#worldEnvLayer');
    const dotsLayer = worldGridContainer.querySelector('#worldDotsLayer');
    const arrowSvg = worldGridContainer.querySelector('#worldArrowLayer');
    const moveArea = worldGridContainer.querySelector('#worldMoveAreaLayer');
    const moveTarget = worldGridContainer.querySelector('#worldMoveTargetLayer');

    // Leeren
    if (trailLayer) trailLayer.innerHTML = '';
    if (seenLayer) seenLayer.innerHTML = '';
    if (envLayer) envLayer.innerHTML = '';
    if (dotsLayer) dotsLayer.innerHTML = '';
    if (arrowSvg) arrowSvg.innerHTML = '';
    if (moveArea) moveArea.innerHTML = '';
    if (moveTarget) moveTarget.innerHTML = '';

    // Sichtbarkeiten berechnen
    worldVisibilityMap.clear();

    const selected = getSelectedBeastIds();
    const activeRound = (logData && logData[currentRoundIndex])
        ? logData[currentRoundIndex].round
        : null;

    // 1) Alle Zellen auf "unentdeckt" zurücksetzen
    const cells = worldGridContainer.querySelectorAll('.world-grid-cell');
    cells.forEach(c => {
        c.style.background = 'var(--world-undiscovered)';
    });

    // Kachelgröße in %
    const tileW = (100 / WORLD_COLS);
    const tileH = (100 / WORLD_ROWS);

    // 2) Trails (letzte N Positionen, schwächer werdend)
    const N = parseInt(worldTrailSlider?.value || '1');

    if (selected.length && trailLayer) {
        selected.forEach(bid => {
            const history = getBeastHistory(bid, activeRound, N);

            for (let i = 0; i < history.length; i++) {
                const h = history[history.length - 1 - i]; // i=0 => aktuell
                if (h.abs_x == null || h.abs_y == null) continue;

                const x = h.abs_x;
                const y = clampWorldY(h.abs_y);

                if (x < WORLD_X_MIN || x > WORLD_X_MAX) continue;

                const div = document.createElement('div');
                div.style.position = 'absolute';
                div.style.left = ((x + Math.floor(WORLD_COLS / 2) + 0.5) * tileW) + '%';
                div.style.top = ((y + Math.floor(WORLD_ROWS / 2) + 0.5) * tileH) + '%';
                div.style.width = (tileW * 0.55) + '%';
                div.style.height = (tileH * 0.55) + '%';
                div.style.transform = 'translate(-50%,-50%)';
                div.style.borderRadius = '9999px';
                div.style.background = getBeastColor(bid);

                const alpha = Math.max(0.7, 1 - (i * (0.3 / Math.max(1, N - 1))));
                div.style.opacity = alpha.toFixed(2);
                div.style.boxShadow = '0 0 8px rgba(0,0,0,0.25)';
                div.style.pointerEvents = 'none';

                trailLayer.appendChild(div);
            }
        });
    }

    // 3) Fading der "gesehenen" Kacheln über N Schritte + aktuelle Env-Overlays
    if (selected.length) {

        // WICHTIG: Schleife UMGEKEHRT -> neueste Steps zuletzt -> liegen OBEN
        for (let step = N - 1; step >= 0; step--) {

            // feste Graustufe je "Alter" der Runde
            let colorVar;
            if (step === 0) {
                colorVar = 'var(--world-seen-0)';      // letzte Runde – hell
            } else if (step === 1) {
                colorVar = 'var(--world-seen-1)';      // vorletzte Runde
            } else if (step === 2) {
                colorVar = 'var(--world-seen-2)';
            } else if (step === 3) {
                colorVar = 'var(--world-seen-3)';
            } else {
                colorVar = 'var(--world-seen-old)';    // alles was noch älter ist
            }

            selected.forEach(bid => {
                let entry = null;

                if (step === 0) {
                    entry = findBeastEntryAtRound(bid, activeRound);
                } else {
                    const hist = getBeastHistory(
                        bid,
                        (activeRound == null ? null : (activeRound - step)),
                        null
                    );
                    entry = hist.length ? hist[hist.length - 1] : null;
                }
                if (!entry || !entry.env || entry.abs_x == null || entry.abs_y == null) return;

                const absx = entry.abs_x;
                const absy = entry.abs_y;
                const env = entry.env;

                for (let i = 0; i < env.length && i < 49; i++) {
                    const { x: dx, y: dy } = indexToLocalXY(i);
                    const x = absx + dx;
                    const y = clampWorldY(absy + dy);

                    if (x < WORLD_X_MIN || x > WORLD_X_MAX) continue;

                    // "gesehen" markieren (feste Graustufe als Kachel)
                    if (seenLayer) {
                        const row = y + Math.floor(WORLD_ROWS / 2);
                        const col = x + Math.floor(WORLD_COLS / 2);

                        const tile = document.createElement('div');
                        tile.style.position = 'absolute';
                        tile.style.left = ((col + 0.5) * tileW) + '%';
                        tile.style.top = ((row + 0.5) * tileH) + '%';
                        tile.style.width = tileW + '%';
                        tile.style.height = tileH + '%';
                        tile.style.transform = 'translate(-50%, -50%)';

                        // feste Farbe, keine Opacity
                        tile.style.background = colorVar;
                        tile.style.borderRadius = '4px';
                        tile.style.pointerEvents = 'none';

                        // WICHTIG:
                        // Weil step von N-1 → 0 läuft,
                        // wird tile für step=0 (neueste Runde)
                        // GANZ ZUM SCHLUSS eingefügt → liegt oben.
                        seenLayer.appendChild(tile);
                    }

                    // Sichtbarkeit (für Klick-Info)
                    const key = `${x},${y}`;
                    if (!worldVisibilityMap.has(key))
                        worldVisibilityMap.set(key, new Set());
                    worldVisibilityMap.get(key).add(String(bid));
                }
            });
        }





        // AKTUELLE RUNDE: Inhalte farbig (B,*,<,>,=) – wie zuvor
        if (envLayer) {
            selected.forEach(bid => {
                const entry = findBeastEntryAtRound(bid, activeRound);
                if (!entry || !entry.env || entry.abs_x == null || entry.abs_y == null) return;

                const absx = entry.abs_x;
                const absy = entry.abs_y;
                const env = entry.env;

                __currentBidContext = bid; // BID-Farbkontext für das Zentrum

                for (let i = 0; i < env.length && i < 49; i++) {
                    const { x: dx, y: dy } = indexToLocalXY(i);
                    const x = absx + dx;
                    const y = clampWorldY(absy + dy);

                    if (x < WORLD_X_MIN || x > WORLD_X_MAX) continue;

                    // Farbfelder für Inhalte (B,*,<,>,=) als Overlay-Rechtecke
                    const isCenter = (dx === 0 && dy === 0);
                    const ch = isCenter ? 'B' : env[i];
                    const color = localCharToColor(ch, isCenter);
                    if (!color) continue;

                    const row = y + Math.floor(WORLD_ROWS / 2);
                    const col = x + Math.floor(WORLD_COLS / 2);

                    const tile = document.createElement('div');
                    tile.style.position = 'absolute';
                    tile.style.left = ((col + 0.5) * tileW) + '%';
                    tile.style.top = ((row + 0.5) * tileH) + '%';
                    tile.style.width = tileW + '%';
                    tile.style.height = tileH + '%';
                    tile.style.transform = 'translate(-50%,-50%)';
                    tile.style.background = color;
                    tile.style.opacity = '0.95';
                    tile.style.borderRadius = '4px';
                    tile.style.pointerEvents = 'none';

                    envLayer.appendChild(tile);
                }

                __currentBidContext = null;
            });
        }
    }

    // 4) Dots-Layer nur für "wichtige" Felder der vergangenen Sicht (N > 1)
    if (selected.length && dotsLayer) {
        for (let step = 1; step <= Math.max(0, N - 1); step++) {
            const opacity = Math.max(0.7, (N - step) / N);


            selected.forEach(bid => {
                const hist = getBeastHistory(
                    bid,
                    (activeRound == null ? null : (activeRound - step)),
                    null
                );
                const entry = hist.length ? hist[hist.length - 1] : null;
                if (!entry || !entry.env || entry.abs_x == null || entry.abs_y == null) return;

                const absx = entry.abs_x;
                const absy = entry.abs_y;
                const env = entry.env;

                for (let i = 0; i < env.length && i < 49; i++) {
                    const { x: dx, y: dy } = indexToLocalXY(i);
                    const x = absx + dx;
                    const y = clampWorldY(absy + dy);

                    if (x < WORLD_X_MIN || x > WORLD_X_MAX) continue;

                    const ch = env[i];
                    let dotColor = null;
                    if (ch === '*') dotColor = '#F97316';           // Food -> Orange
                    else if (ch === '<') dotColor = '#10B981';      // kleiner Gegner -> Grün
                    else if (ch === '>' || ch === '=') dotColor = '#EF4444'; // großer Gegner -> Rot
                    else continue; // leere Felder: keine Dots

                    const row = y + Math.floor(WORLD_ROWS / 2);
                    const col = x + Math.floor(WORLD_COLS / 2);

                    const dot = document.createElement('div');
                    dot.style.position = 'absolute';
                    dot.style.left = ((col + 0.5) * tileW) + '%';
                    dot.style.top = ((row + 0.5) * tileH) + '%';

                    const d = Math.min(tileW, tileH) * 0.35;
                    dot.style.width = d + '%';
                    dot.style.height = d + '%';

                    dot.style.transform = 'translate(-50%,-50%)';
                    dot.style.borderRadius = '9999px';
                    dot.style.background = dotColor;
                    dot.style.opacity = opacity.toFixed(2);
                    dot.style.pointerEvents = 'none';

                    dotsLayer.appendChild(dot);
                }
            });
        }
    }

    // 5) Pfeil-Layer (SVG) für aktivierte Beasts – kleiner/feiner
    const Nloc = parseInt(worldTrailSlider?.value || '1');
    if (arrowSvg && arrowEnabledBeasts.size > 0) {
        arrowEnabledBeasts.forEach(bid => {
            if (!getSelectedBeastIds().includes(bid)) return; // nur wenn ausgewählt

            const history = getBeastHistory(bid, activeRound, Nloc);
            if (history.length < 2) return;

            // Marker definieren (kleinerer Arrowhead)
            const markerId = `arrowhead-${bid.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');

            marker.setAttribute('id', markerId);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '7');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '1.6');
            marker.setAttribute('markerHeight', '1.6');
            marker.setAttribute('orient', 'auto-start-reverse');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            path.setAttribute('fill', getBeastColor(bid));

            marker.appendChild(path);
            defs.appendChild(marker);
            arrowSvg.appendChild(defs);

            // Linien zeichnen (ältere -> blasser)
            for (let i = 1; i < history.length; i++) {
                const a = history[i - 1];
                const b = history[i];

                if (a.abs_x == null || a.abs_y == null ||
                    b.abs_x == null || b.abs_y == null) continue;

                const ax = a.abs_x + Math.floor(WORLD_COLS / 2) + 0.5;
                const ay = clampWorldY(a.abs_y) + Math.floor(WORLD_ROWS / 2) + 0.5;

                const bx = b.abs_x + Math.floor(WORLD_COLS / 2) + 0.5;
                const by = clampWorldY(b.abs_y) + Math.floor(WORLD_ROWS / 2) + 0.5;

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', ax);
                line.setAttribute('y1', ay);
                line.setAttribute('x2', bx);
                line.setAttribute('y2', by);

                const alpha = Math.max(0.25, (i / (history.length - 1))); // spätere Segmente kräftiger
                line.setAttribute('stroke', getBeastColor(bid));
                line.setAttribute('stroke-opacity', alpha.toFixed(2));
                line.setAttribute('stroke-width', '0.35');
                line.setAttribute('marker-end', `url(#${markerId})`);

                arrowSvg.appendChild(line);
            }
        });
    }

    // 6) Move-Target-Rahmen & 5×5-Move-Bereich (absolute Koordinaten)
    if (selected.length) {
        selected.forEach(bid => {
            const entry = findBeastEntryAtRound(bid, activeRound);
            if (!entry) return;

            // 5x5 Bereich um (abs_x, abs_y)
            if (entry.abs_x != null && entry.abs_y != null && moveArea) {
                const leftCol = (entry.abs_x - 2) + Math.floor(WORLD_COLS / 2);
                const topRow = clampWorldY(entry.abs_y - 2) + Math.floor(WORLD_ROWS / 2);

                const areaDiv = document.createElement('div');
                areaDiv.style.position = 'absolute';
                areaDiv.style.left = (leftCol * tileW) + '%';
                areaDiv.style.top = (topRow * tileH) + '%';
                areaDiv.style.width = (5 * tileW) + '%';
                areaDiv.style.height = (5 * tileH) + '%';
                areaDiv.style.border = '3px solid #7C3AED';
                areaDiv.style.borderRadius = '6px';
                areaDiv.style.boxShadow = '0 0 12px rgba(124,58,237,0.15)';
                areaDiv.style.pointerEvents = 'none';

                moveArea.appendChild(areaDiv);
            }

            // Move-Target (pink) um Zielzelle
            const mv = (entry.move && entry.move.length === 2) ? entry.move : null;

            if (mv && moveTarget && entry.abs_x != null && entry.abs_y != null) {
                const tx = entry.abs_x + mv[0];
                const ty = clampWorldY(entry.abs_y + mv[1]);

                const col = tx + Math.floor(WORLD_COLS / 2);
                const row = ty + Math.floor(WORLD_ROWS / 2);

                if (col >= 0 && col < WORLD_COLS && row >= 0 && row < WORLD_ROWS) {
                    const tDiv = document.createElement('div');
                    tDiv.style.position = 'absolute';
                    tDiv.style.left = (col * tileW) + '%';
                    tDiv.style.top = (row * tileH) + '%';
                    tDiv.style.width = tileW + '%';
                    tDiv.style.height = tileH + '%';
                    tDiv.style.border = '3px solid #EC4899';
                    tDiv.style.borderRadius = '4px';
                    tDiv.style.pointerEvents = 'none';

                    moveTarget.appendChild(tDiv);
                }
            }
        });
    }

    worldLastRoundForLayers = currentRoundIndex;
}

/* --- Layout/Zoom-Helfer für World --- */
function fitWorldGridToWrapper() {
    if (!worldGridContainer) return;
    const wrapper = document.querySelector('.world-map-wrapper');
    if (!wrapper) return;

    const wrapperW = wrapper.clientWidth;
    const wrapperH = wrapper.clientHeight;

    // aktuelle CSS-Werte
    const computed = getComputedStyle(worldGridContainer);
    const gap = parseFloat(computed.gap) || 2;
    const border = 4 * 2; // 4px je Seite

    // Breiten-/Höhenbasierter Zell-Size
    const cellByW = (wrapperW - border - gap * (WORLD_COLS - 1)) / WORLD_COLS;
    const cellByH = (wrapperH - border - gap * (WORLD_ROWS - 1)) / WORLD_ROWS;

    const cell = Math.max(8, Math.floor(Math.min(cellByW, cellByH)));
    worldGridContainer.style.setProperty('--world-cell', `${cell}px`);
}

/* --- DOM-Initialisierung NACH Passwort-Check (unverändert, plus World-Hooks) --- */
let playbackInterval = null;
let isPlaying = false;

function initAppDom() {
    // Standard-DOM
    fileInput = document.getElementById('fileInput');
    serverLogInput = document.getElementById('serverLogInput');
    gridContainer = document.getElementById('gridContainer');
    gridContainerModal = document.getElementById('gridContainerModal');
    envGridDisplay = document.getElementById('envGridDisplay');

    roundIndicator = document.getElementById('roundIndicator');
    prevRoundButton = document.getElementById('prevRound');
    nextRoundButton = document.getElementById('nextRound');
    timelineSlider = document.getElementById('timelineSlider');

    playPauseButton = document.getElementById('playPauseButton');
    playIcon = document.getElementById('playIcon');
    pauseIcon = document.getElementById('pauseIcon');
    fpsInput = document.getElementById('fpsInput');

    zoomButton = document.getElementById('zoomButton');
    zoomModal = document.getElementById('zoomModal');
    modalRoundIndicator = document.getElementById('modalRoundIndicator');

    serverLogsContainer = document.getElementById('serverLogsContainer');
    serverLogStatus = document.getElementById('serverLogStatus');
    copyEnvButton = document.getElementById('copyEnvButton');

    // Navigation
    navBeaster = document.getElementById('navBeaster');
    navWorld = document.getElementById('navWorld');
    beasterDashboard = document.getElementById('beasterDashboard');
    worldDashboard = document.getElementById('worldDashboard');
    switchToWorld = document.getElementById('switchToWorld');
    switchToBeaster = document.getElementById('switchToBeaster');

    // Datei-Management
    fileCount = document.getElementById('fileCount');
    serverLogFileCount = document.getElementById('serverLogFileCount');
    fileDropdownContainer = document.getElementById('fileDropdownContainer');
    fileSelector = document.getElementById('fileSelector');

    // Control-Bar
    controlBarToggle = document.getElementById('controlBarToggle');
    controlsInner = document.getElementById('controlsInner');

    // World-Dashboard
    worldBeastList = document.getElementById('worldBeastList');
    worldSelectAll = document.getElementById('worldSelectAll');
    worldBeastCount = document.getElementById('worldBeastCount');
    worldGridContainer = document.getElementById('worldGrid71x34');
    serverLogsContainerWorld = document.getElementById('serverLogsContainerWorld');
    serverLogStatusWorld = document.getElementById('serverLogStatusWorld');
    worldTrailSlider = document.getElementById('worldTrailSlider');
    worldTrailValue = document.getElementById('worldTrailValue');
    worldZoomSlider = document.getElementById('worldZoomSlider');
    worldZoomValue = document.getElementById('worldZoomValue');
    worldScaleWrap = document.getElementById('worldScaleWrap');

    /* Button: Env kopieren */
    if (copyEnvButton) {
        copyEnvButton.addEventListener('click', () => {
            const envString = (logData &&
                logData[currentRoundIndex] &&
                logData[currentRoundIndex].env) || '.'.repeat(49);

            copyText(envString, copyEnvButton);
        });
    }

    /* Tabs / Pfeile */
    navBeaster.addEventListener('click', () =>
        switchDashboard('beasterDashboard')
    );

    navWorld.addEventListener('click', () =>
        switchDashboard('worldDashboard')
    );

    if (switchToWorld) {
        switchToWorld.addEventListener('click', () => {
            navWorld.click();
            window.scrollTo(0, 0);
        });
    }

    if (switchToBeaster) {
        switchToBeaster.addEventListener('click', () => {
            navBeaster.click();
            window.scrollTo(0, 0);
        });
    }

    /* Control-Bar Toggle */
    if (controlBarToggle && controlsInner) {
        controlBarToggle.addEventListener('click', () => {
            const willHide = !controlsInner.classList.contains('hidden');
            controlsInner.classList.toggle('hidden', willHide);
            controlBarToggle.setAttribute('aria-expanded', (!willHide).toString());
        });
    }

    /* Datei-Auswahl Dropdown */
    fileSelector.addEventListener('change', e => {
        selectActiveFile(e.target.value);
    });

    /* Spiel-Log Upload */
    fileInput.addEventListener('change', async e => {
        const files = e.target.files;
        if (!files || files.length === 0) {
            fileCount.textContent = 'Keine Datei(en)';
            return;
        }

        togglePlayback(false);
        allLogData = {};
        fileCount.textContent = `Lade ${files.length} Datei(en)...`;

        const fileReadPromises = [];

        for (const file of files) {
            fileReadPromises.push(
                readFileAsText(file).then(content => {
                    try {
                        let parsed = parseNDJSONContentToArray(content);

                        if (parsed.length > 0) {
                            const firstRound = parseInt(parsed[0].round);
                            if (isNaN(firstRound) || firstRound > 0) {
                                parsed.unshift({
                                    round: 0,
                                    env: '.'.repeat(49),
                                    event: 'Server-Start',
                                    bid: '',
                                    energ: 0,
                                    move: null,
                                    foodlist: [],
                                    huntlist: [],
                                    escapelist: [],
                                    priorityfood: 0,
                                    priorityhunt: 0,
                                    priorityescape: 0
                                });
                            }
                        }

                        allLogData[file.name] = parsed;
                    } catch (err) {
                        console.error(`Fehler beim Parsen von ${file.name}:`, err);
                    }
                })
            );
        }

        await Promise.all(fileReadPromises);

        const loadedFileNames = Object.keys(allLogData);
        if (loadedFileNames.length > 0) {
            fileCount.textContent = `${loadedFileNames.length} Datei(en) geladen`;

            updateFileSelector();
            selectActiveFile(loadedFileNames[0]);

            // World-Beast-IDs aktualisieren (inkl. feste Palette)
            updateBeastIdListWorld();

            // World-Logs initial sichtbar machen
            renderServerLogsForRoundWorld(logData && logData[0] ? logData[0].round : null);
            renderWorldVisualization();
        } else {
            fileCount.textContent = 'Keine gültigen Logs';
            resetUIForNoData();
            updateFileSelector();
            updateBeastIdListWorld();
        }
    });

    /* Server-Log Upload */
    serverLogInput.addEventListener('change', async e => {
        const files = e.target.files;
        if (!files || files.length === 0) {
            serverLogFileCount.textContent = 'Keine Logs';
            return;
        }

        allServerLogs = [];
        serverLogFileCount.textContent = `Lade ${files.length} Log(s)...`;

        const fileReadPromises = [];

        for (const file of files) {
            fileReadPromises.push(
                readFileAsText(file).then(content => {
                    try {
                        const parsed = parseNDJSONContentToArray(content);
                        allServerLogs.push(...parsed);
                    } catch (err) {
                        console.error(`Fehler beim Parsen von ${file.name} (Server-Log):`, err);
                    }
                })
            );
        }

        await Promise.all(fileReadPromises);

        serverLogFileCount.textContent =
            `${files.length} Log(s) geladen`;
        serverLogStatus.textContent =
            `geladen (${allServerLogs.length} Einträge)`;

        if (logData && logData.length > 0 && logData[currentRoundIndex]) {
            renderServerLogsForRound(logData[currentRoundIndex].round);
            renderServerLogsForRoundWorld(logData[currentRoundIndex].round);
        } else {
            renderServerLogsForRound(null);
            renderServerLogsForRoundWorld(null);
        }
    });

    /* Rundennavigation & Playback */
    prevRoundButton.addEventListener('click', () => {
        togglePlayback(false);
        goToRound(currentRoundIndex - 1);
    });

    nextRoundButton.addEventListener('click', () => {
        togglePlayback(false);
        goToRound(currentRoundIndex + 1);
    });

    timelineSlider.addEventListener('input', e => {
        togglePlayback(false);
        goToRound(parseInt(e.target.value));
    });

    playPauseButton.addEventListener('click', () => {
        if (logData.length > 0) togglePlayback();
    });

    fpsInput.addEventListener('change', () => {
        const val = parseInt(fpsInput.value);
        if (val < 1) fpsInput.value = 1;
        if (val > 60) fpsInput.value = 60;

        if (isPlaying) {
            togglePlayback(false);
            togglePlayback(true);
        }
    });

    zoomButton.addEventListener('click', openModal);

    /* Klick-Handler für die Augen-Icons (F/H/E) */
    document.querySelectorAll('.eye-icon').forEach(btn => {
        btn.addEventListener('click', () => {
            const listName = btn.getAttribute('data-list');
            if (activeListForOverlay === listName) {
                hideOverlay();
            } else {
                hideOverlay();
                showListOverlay(listName);
            }
        });
    });

    /* Keyboard Shortcuts (global erweitert) */
    window.addEventListener('keydown', e => {
        const tagName = document.activeElement && document.activeElement.tagName;
        const isInputLike = document.activeElement &&
            (document.activeElement.isContentEditable ||
                tagName === 'INPUT' ||
                tagName === 'TEXTAREA' ||
                tagName === 'SELECT');

        if (e.key === 'Escape') {
            closeModal();
            closeListModal();
            return;
        }

        if (isInputLike) return;

        if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            if (!playPauseButton.disabled) playPauseButton.click();
            return;
        }

        // NEU: Up/Down wechselt Dashboard (immer)
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            navBeaster?.click();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            navWorld?.click();
            return;
        }

        // Ab hier: Rundennavigation & List-Shortcuts
        if (!logData || logData.length === 0) return;

        const key = (e.key && e.key.length === 1)
            ? e.key.toLowerCase()
            : e.key;

        switch (key) {
            case 'ArrowRight':
                // → immer Runden weiter, egal welches Dashboard aktiv
                e.preventDefault();
                togglePlayback(false);
                if (currentRoundIndex < logData.length - 1)
                    goToRound(currentRoundIndex + 1);
                break;

            case 'ArrowLeft':
                // ← immer Runden zurück, egal welches Dashboard aktiv
                e.preventDefault();
                togglePlayback(false);
                if (currentRoundIndex > 0)
                    goToRound(currentRoundIndex - 1);
                break;

            case 'f':
            case 'h':
            case 'e':
                // f/h/e nur im Biester-Dashboard für die Listen
                if (currentDashboard !== 'beasterDashboard') break;

                e.preventDefault();
                if (key === 'f') triggerListButton('foodlist');
                if (key === 'h') triggerListButton('huntlist');
                if (key === 'e') triggerListButton('escapelist');
                break;
        }
    });


    /* World: Select-All Checkbox */
    if (worldSelectAll) {
        worldSelectAll.addEventListener('change', e => {
            if (!worldBeastList) return;
            worldBeastList
                .querySelectorAll('.world-bid-checkbox')
                .forEach(cb => cb.checked = e.target.checked);

            renderWorldVisualization();
        });
    }

    /* World: Grid & Layer aufbauen & Logs initialisieren */
    buildWorldGrid71x34();
    renderServerLogsForRoundWorld(null);

    /* World: Polling (Overlays bei Playback mitlaufen lassen) */
    window.__worldLogPoll = setInterval(() => {
        if (!logData || !logData.length) return;

        if (typeof window.__lastRoundWorld !== 'number')
            window.__lastRoundWorld = -1;

        if (currentRoundIndex !== window.__lastRoundWorld) {
            window.__lastRoundWorld = currentRoundIndex;
            const r = logData[currentRoundIndex]
                ? logData[currentRoundIndex].round
                : null;
            renderServerLogsForRoundWorld(r);
        }

        if (currentRoundIndex !== worldLastRoundForLayers) {
            renderWorldVisualization();
        }
    }, 200);

    /* Slider-Änderung -> Trails & Dots & Fading neu zeichnen */
    if (worldTrailSlider && worldTrailValue) {
        worldTrailSlider.addEventListener('input', () => {
            worldTrailValue.textContent = worldTrailSlider.value;
            renderWorldVisualization();
        });
        worldTrailValue.textContent = worldTrailSlider.value;
    }

    /* Zoom-Regler – nur World-Grid skalieren */
    if (worldZoomSlider && worldZoomValue && worldScaleWrap) {
        const updateZoom = () => {
            const val = parseFloat(worldZoomSlider.value || '1') || 1;
            worldZoomValue.textContent = `${Math.round(val * 100)}%`;
            worldScaleWrap.style.transform = `scale(${val})`;
        };
        worldZoomSlider.addEventListener('input', updateZoom);
        updateZoom();
    }

    /* Beim Resize die Zellenbreite dynamisch anpassen */
    window.addEventListener('resize', fitWorldGridToWrapper);

    /* Start: leere UI */
    resetUIForNoData();
}

/* Passwort-Logik / Unlock (unverändert) */
const PASSWORD = 'g';

function unlockApp() {
    const appRoot = document.getElementById('appRoot');
    const template = document.getElementById('appTemplate');
    const passwordScreen = document.getElementById('passwordScreen');

    if (!appRoot || !template) return;

    const clone = template.content.cloneNode(true);
    appRoot.appendChild(clone);
    appRoot.classList.remove('hidden');

    if (passwordScreen) passwordScreen.remove();

    initAppDom();
}

function setupPasswordGate() {
    const form = document.getElementById('passwordForm');
    const input = document.getElementById('passwordInput');
    const errorEl = document.getElementById('passwordError');

    if (!form || !input) return;

    form.addEventListener('submit', e => {
        e.preventDefault();

        const value = input.value || '';
        if (value === PASSWORD) {
            errorEl.textContent = '';
            unlockApp();
        } else {
            errorEl.textContent = 'Falsches Passwort.';
            input.value = '';
            input.focus();
        }
    });

    setTimeout(() => {
        input.focus();
    }, 0);
}

setupPasswordGate();
