const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, currentMonitor } = window.__TAURI__.window;

// Helper function to add timeout to invoke calls
async function invokeWithTimeout(command, args = {}, timeoutMs = 30000) {
    return Promise.race([
        invoke(command, args),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs / 1000} seconds`)), timeoutMs)
        )
    ]);
}

let inputDirPath = '';
let outputDirPath = '';
let outputDirFromStack = '';
let allFiles = [];
let selectedIndices = new Set();

// Elements
const statusEl = document.getElementById('status-bar');
const inputDirEl = document.getElementById('inputDir');
const outputDirEl = document.getElementById('outputDir');
const browseInputBtn = document.getElementById('browseInput');
const browseOutputBtn = document.getElementById('browseOutput');
const startButton = document.getElementById('startButton');
const inputValidationEl = document.getElementById('inputValidation');
const progressDialog = document.getElementById('progressDialog');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const overlay = document.getElementById('overlay');
const openOutputButton = document.getElementById('openOutputButton');
const cancelStackingButton = document.getElementById('cancelStackingButton');
const fileListEl = document.getElementById('fileList');
const fileListTitleEl = document.getElementById('fileListTitle');
const previewContentEl = document.getElementById('previewContent');
const previewFilenameEl = document.getElementById('previewFilename');
const maximizedImageOverlay = document.getElementById('maximizedImageOverlay');
const maximizedImage = document.getElementById('maximizedImage');

// Window position persistence
async function saveWindowPosition() {
    const window = getCurrentWindow();

    try {
        const [position, size, monitor] = await Promise.all([
            window.outerPosition(),
            window.outerSize(),
            currentMonitor()
        ]);

        const windowState = {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            monitorName: monitor?.name || null,
            timestamp: Date.now()
        };
        localStorage.setItem('windowState', JSON.stringify(windowState));
    } catch (error) {
        console.error('Failed to save window position:', error);
    }
}

async function restoreWindowPosition() {
    try {
        const savedState = localStorage.getItem('windowState');
        if (!savedState) {
            return false; // No saved state, use default sizing
        }

        const state = JSON.parse(savedState);

        // Validate state has valid numbers
        if (!state.width || !state.height || !state.x || !state.y ||
            typeof state.width !== 'number' || typeof state.height !== 'number' ||
            typeof state.x !== 'number' || typeof state.y !== 'number') {
            console.warn('Invalid saved window state, clearing and using defaults');
            localStorage.removeItem('windowState');
            return false;
        }

        // Check if we're on the same monitor
        const monitor = await currentMonitor();
        if (state.monitorName && monitor?.name !== state.monitorName) {
            console.log(`Monitor changed from '${state.monitorName}' to '${monitor?.name}', using default sizing`);
            return false; // Different monitor, use default sizing
        }

        const window = getCurrentWindow();

        // Restore position and size using Physical coordinates
        await window.setSize({ type: 'Physical', width: state.width, height: state.height });
        await window.setPosition({ type: 'Physical', x: state.x, y: state.y });

        return true; // Successfully restored
    } catch (error) {
        console.error('Failed to restore window position:', error);
        return false;
    }
}

// Shared function to load and parse user recipe
async function loadUserRecipeYaml(recipeId) {
    try {
        const yamlContent = await invoke('load_user_recipe', { recipeId });
        try {
            const recipe = jsyaml.load(yamlContent);
            return { success: true, recipe, yamlContent };
        } catch (yamlError) {
            return { success: false, error: `Invalid YAML format: ${yamlError.message}` };
        }
    } catch (error) {
        return { success: false, error: error.toString() };
    }
}

// ==================== Queue Management System ====================

// Queue state
let stackingQueue = [];
let isBatchProcessing = false;
let currentBatchIndex = -1;

// Load queue from localStorage
function loadQueue() {
    try {
        const stored = localStorage.getItem('stackingQueue');
        if (stored) {
            const parsed = JSON.parse(stored);

            // Validate queue data integrity
            if (!Array.isArray(parsed)) {
                console.warn('Queue data is not an array, resetting');
                stackingQueue = [];
            } else {
                // Validate each item has required fields
                stackingQueue = parsed.filter(item => {
                    return item &&
                           typeof item.id === 'string' &&
                           typeof item.timestamp === 'number' &&
                           typeof item.status === 'string' &&
                           item.config &&
                           typeof item.config === 'object';
                });

                // Clear old completed/failed jobs (>24 hours)
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                stackingQueue = stackingQueue.filter(item => {
                    return item.status === 'pending' || item.timestamp > cutoff;
                });

                saveQueue();
            }
        }
    } catch (error) {
        console.error('Failed to load queue:', error);
        stackingQueue = [];
    }
    updateQueueBadge();
}

// Save queue to localStorage
function saveQueue() {
    try {
        localStorage.setItem('stackingQueue', JSON.stringify(stackingQueue));
        updateQueueBadge();
    } catch (error) {
        console.error('Failed to save queue:', error);
    }
}

// Update queue badge count and button state
function updateQueueBadge() {
    const pendingCount = stackingQueue.filter(item => item.status === 'pending').length;

    // Update "Open Queue" button
    const openQueueBtn = document.getElementById('openQueueBtn');
    if (openQueueBtn) {
        if (pendingCount > 0) {
            openQueueBtn.textContent = `Open Queue (${pendingCount})`;
            openQueueBtn.disabled = false;
        } else {
            openQueueBtn.textContent = 'Open Queue';
            openQueueBtn.disabled = true;
        }
    }
}

// Generate UUID for queue items
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper to collect form configuration
function collectFormConfig() {
    return {
        inputDir: document.getElementById('inputDir').value.trim(),
        outputDir: document.getElementById('outputDir').value.trim(),
        recipe: document.getElementById('recipe').value,
        quality: parseInt(document.getElementById('quality').value),
        pngCompressLevel: parseInt(document.getElementById('pngCompressLevel').value),
        tiffCompression: document.getElementById('tiffCompression').value,
        stackingMode: document.getElementById('stacking').value,
        dryRun: false,
        startFrame: parseInt(document.getElementById('startFrame').value) || null,
        endFrame: parseInt(document.getElementById('endFrame').value) || null,
        trailLength: parseInt(document.getElementById('trailLength').value),
        frameInterval: parseInt(document.getElementById('frameInterval').value),
        trailGradient: document.getElementById('trailGradient').checked,
        gradientDecay: parseFloat(document.getElementById('gradientDecay').value),
        gradientPlateau: parseInt(document.getElementById('gradientPlateau').value)
    };
}

// Add job to queue
async function addToQueue() {
    // Validate input directory first
    const inputDir = document.getElementById('inputDir').value.trim();
    if (!inputDir) {
        alert('Please select an input directory');
        return;
    }

    // Collect current form configuration
    const config = collectFormConfig();

    // Validate output directory is not empty
    if (!config.outputDir) {
        alert('Please select an output directory');
        return;
    }

    // Check queue size limit
    const pendingCount = stackingQueue.filter(i => i.status === 'pending').length;
    if (pendingCount >= 50) {
        if (!confirm('You have 50 or more jobs in the queue. Adding more jobs may impact performance. Continue?')) {
            return;
        }
    }

    // Validate unique output directory
    const duplicate = stackingQueue.find(item =>
        item.status === 'pending' && item.config.outputDir === config.outputDir
    );

    if (duplicate) {
        alert('This output directory is already in the queue. Please choose a different output directory.');
        return;
    }

    // Create queue item
    const queueItem = {
        id: generateUUID(),
        timestamp: Date.now(),
        status: 'pending',
        config: config,
        error: null
    };

    // Add to queue
    stackingQueue.push(queueItem);
    saveQueue();

    // Clear only output directory field
    document.getElementById('outputDir').value = '';

    // Show confirmation
    alert(`Added to queue! ${stackingQueue.filter(i => i.status === 'pending').length} job(s) pending.`);
}

// Remove job from queue
function removeQueueItem(id) {
    const item = stackingQueue.find(i => i.id === id);
    if (!item) return;

    if (item.status === 'processing') {
        alert('Cannot remove a job that is currently processing');
        return;
    }

    if (confirm('Remove this job from the queue?')) {
        stackingQueue = stackingQueue.filter(i => i.id !== id);
        saveQueue();
        renderQueueList();
    }
}

// Move queue item up
function moveQueueItemUp(id) {
    const index = stackingQueue.findIndex(i => i.id === id);
    if (index > 0) {
        [stackingQueue[index - 1], stackingQueue[index]] =
        [stackingQueue[index], stackingQueue[index - 1]];
        saveQueue();
        renderQueueList();
    }
}

// Move queue item down
function moveQueueItemDown(id) {
    const index = stackingQueue.findIndex(i => i.id === id);
    if (index < stackingQueue.length - 1 && index >= 0) {
        [stackingQueue[index], stackingQueue[index + 1]] =
        [stackingQueue[index + 1], stackingQueue[index]];
        saveQueue();
        renderQueueList();
    }
}

// Clear completed jobs
function clearCompleted() {
    const completedCount = stackingQueue.filter(i =>
        i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled'
    ).length;

    if (completedCount === 0) {
        alert('No completed jobs to clear');
        return;
    }

    if (confirm(`Clear ${completedCount} completed job(s)?`)) {
        stackingQueue = stackingQueue.filter(i => i.status === 'pending' || i.status === 'processing');
        saveQueue();
        renderQueueList();
    }
}

// Open queue dialog
function openQueueDialog() {
    document.getElementById('queueDialog').classList.remove('hidden');
    renderQueueList();
}

// Close queue dialog
function closeQueueDialog() {
    document.getElementById('queueDialog').classList.add('hidden');
}

// Render queue list
function renderQueueList() {
    const queueList = document.getElementById('queueList');
    const emptyMessage = document.getElementById('emptyQueueMessage');
    const startBatchBtn = document.getElementById('startBatchBtn');
    const clearCompletedBtn = document.getElementById('clearCompletedBtn');

    if (stackingQueue.length === 0) {
        emptyMessage.style.display = 'block';
        queueList.innerHTML = '';
        startBatchBtn.disabled = true;
        clearCompletedBtn.disabled = true;
        return;
    }

    emptyMessage.style.display = 'none';

    queueList.innerHTML = stackingQueue.map((item, index) => {
        const inputDirName = item.config.inputDir.split(/[\\/]/).pop() || item.config.inputDir;
        const outputDirName = item.config.outputDir.split(/[\\/]/).pop() || item.config.outputDir;

        return `
            <div class="queue-item" data-id="${item.id}">
                <div class="queue-item-status status-${item.status}">
                    <span class="status-icon"></span>
                </div>
                <div class="queue-item-details">
                    <div class="queue-item-primary">
                        <strong>${inputDirName}</strong> → <strong>${outputDirName}</strong>
                    </div>
                    <div class="queue-item-secondary">
                        Recipe: ${item.config.recipe} | Mode: ${item.config.stackingMode}
                        ${item.error ? `<br><span style="color: #f44336;">Error: ${item.error}</span>` : ''}
                    </div>
                </div>
                <div class="queue-item-actions">
                    ${item.status === 'pending' ? `
                        <button class="icon-button" onclick="moveQueueItemUp('${item.id}')"
                                ${index === 0 ? 'disabled' : ''} title="Move Up">↑</button>
                        <button class="icon-button" onclick="moveQueueItemDown('${item.id}')"
                                ${index === stackingQueue.length - 1 ? 'disabled' : ''} title="Move Down">↓</button>
                    ` : ''}
                    ${item.status !== 'processing' ? `
                        <button class="icon-button delete" onclick="removeQueueItem('${item.id}')" title="Remove">×</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Enable/disable buttons based on queue state
    const hasPending = stackingQueue.some(i => i.status === 'pending');
    const hasCompleted = stackingQueue.some(i =>
        i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled'
    );

    startBatchBtn.disabled = !hasPending;
    clearCompletedBtn.disabled = !hasCompleted;
}

// Execute single stacking job with progress dialog
async function executeStackingJob(config) {
    return new Promise((resolve) => {
        // Show progress dialog (reuse existing one)
        const progressDialog = document.getElementById('progressDialog');
        const progressBar = progressDialog.querySelector('.progress-bar');
        const progressText = progressDialog.querySelector('.progress-text');
        const progressLog = progressDialog.querySelector('.progress-log');
        const cancelBtn = document.getElementById('cancelStackingBtn');

        progressDialog.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressText.textContent = 'Starting...';
        progressLog.innerHTML = '';

        let cancelled = false;

        // Set up cancel handler
        const cancelHandler = () => {
            cancelled = true;
            cancelCurrentStack(); // Call existing cancel function
        };

        cancelBtn.onclick = cancelHandler;

        // Set up progress listener
        const unlisten = listen('stacking-progress', (event) => {
            const data = event.payload;

            if (data.type === 'progress') {
                const percent = (data.current / data.total) * 100;
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `Processing frame ${data.current} of ${data.total}`;
            } else if (data.type === 'log') {
                const logEntry = document.createElement('div');
                logEntry.textContent = data.message;
                progressLog.appendChild(logEntry);
                progressLog.scrollTop = progressLog.scrollHeight;
            } else if (data.type === 'complete') {
                unlisten.then(fn => fn());
                progressDialog.classList.add('hidden');
                resolve(!cancelled);
            } else if (data.type === 'error') {
                unlisten.then(fn => fn());
                progressDialog.classList.add('hidden');
                resolve(false);
            }
        });

        // Start stacking via Rust backend
        invoke('start_stacking', { config }).catch(error => {
            console.error('Stacking error:', error);
            unlisten.then(fn => fn());
            progressDialog.classList.add('hidden');
            resolve(false);
        });

        // Check if cancelled during processing
        const checkCancelled = setInterval(() => {
            if (cancelled) {
                clearInterval(checkCancelled);
                unlisten.then(fn => fn());
                progressDialog.classList.add('hidden');
                resolve('cancelled');
            }
        }, 500);
    });
}

// Show cancel queue dialog
function showCancelQueueDialog() {
    return new Promise((resolve) => {
        const response = confirm(
            'Cancel the entire queue or just the current job?\n\n' +
            'OK = Cancel entire queue\n' +
            'Cancel = Skip current job, continue queue'
        );
        resolve(response);
    });
}

// Start batch processing
async function startBatchProcessing() {
    const pendingJobs = stackingQueue.filter(item => item.status === 'pending');

    if (pendingJobs.length === 0) {
        alert('No pending jobs to process');
        return;
    }

    if (!confirm(`Start processing ${pendingJobs.length} job(s)?`)) {
        return;
    }

    // Close queue dialog
    closeQueueDialog();

    isBatchProcessing = true;

    for (let i = 0; i < stackingQueue.length; i++) {
        const item = stackingQueue[i];

        if (item.status !== 'pending') continue;

        currentBatchIndex = i;
        item.status = 'processing';
        saveQueue();

        try {
            // Execute stacking with progress dialog
            const success = await executeStackingJob(item.config);

            if (success === 'cancelled') {
                // Ask user: cancel current or entire queue?
                const cancelAll = await showCancelQueueDialog();

                if (cancelAll) {
                    // Cancel entire queue
                    item.status = 'cancelled';
                    // Mark all remaining pending as cancelled
                    for (let j = i + 1; j < stackingQueue.length; j++) {
                        if (stackingQueue[j].status === 'pending') {
                            stackingQueue[j].status = 'cancelled';
                        }
                    }
                    saveQueue();
                    break; // Exit batch processing loop
                } else {
                    // Cancel only current job, continue with queue
                    item.status = 'cancelled';
                    saveQueue();
                    continue;
                }
            } else if (success) {
                item.status = 'completed';
            } else {
                item.status = 'failed';
                item.error = 'Stacking failed';
            }
        } catch (error) {
            item.status = 'failed';
            item.error = error.message || 'Unknown error';
            console.error('Batch processing error:', error);
        }

        saveQueue();
    }

    isBatchProcessing = false;
    currentBatchIndex = -1;

    // Show completion summary
    const completed = stackingQueue.filter(i => i.status === 'completed').length;
    const failed = stackingQueue.filter(i => i.status === 'failed').length;
    const cancelled = stackingQueue.filter(i => i.status === 'cancelled').length;

    alert(`Batch processing complete!\n\nCompleted: ${completed}\nFailed: ${failed}\nCancelled: ${cancelled}`);
}

// ==================== End Queue Management System ====================

// Initialize
async function init() {
    // Try to restore saved window position first
    const restored = await restoreWindowPosition();

    // If no saved position, dynamically size window to 80% of screen height
    if (!restored) {
        try {
            const monitor = await currentMonitor();
            if (monitor && monitor.size) {
                const screenHeight = monitor.size.height;
                const targetHeight = Math.floor(screenHeight * 0.8);

                // Maintain 1.5 aspect ratio (width:height = 3:2)
                const targetWidth = Math.floor(targetHeight * 1.5);

                const window = getCurrentWindow();
                await window.setSize({ type: 'Physical', width: targetWidth, height: targetHeight });
                await window.center();
            }
        } catch (error) {
            console.error('Failed to resize window:', error);
        }
    }

    // Save window position when it moves or resizes
    let saveTimeout;
    const window = getCurrentWindow();

    // Listen for window move/resize events
    await listen('tauri://move', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveWindowPosition, 500);
    });

    await listen('tauri://resize', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveWindowPosition, 500);
    });

    // Save position when window closes
    await listen('tauri://close-requested', () => {
        saveWindowPosition();
    });

    // Load and apply preferences
    loadPreferences();

    // Refresh recipe dropdown to include user recipes
    await refreshRecipeDropdown();

    try {
        const version = await invoke('get_app_version');
        statusEl.textContent = `imgstax v${version}`;
    } catch (error) {
        statusEl.textContent = `Error: ${error}`;
    }

    // Load queue on startup
    loadQueue();

    // Set up event listeners
    browseInputBtn.addEventListener('click', browseInputDirectory);
    browseOutputBtn.addEventListener('click', browseOutputDirectory);
    startButton.addEventListener('click', startStacking);
    openOutputButton.addEventListener('click', openOutputFolder);
    cancelStackingButton.addEventListener('click', cancelStacking);

    // Queue system event listeners
    document.getElementById('addToQueueBtn').addEventListener('click', addToQueue);
    document.getElementById('openQueueBtn').addEventListener('click', openQueueDialog);
    document.getElementById('viewQueueBtn').addEventListener('click', openQueueDialog);
    document.getElementById('startBatchBtn').addEventListener('click', startBatchProcessing);
    document.getElementById('clearCompletedBtn').addEventListener('click', clearCompleted);

    // Maximized image overlay - close on click
    maximizedImageOverlay.addEventListener('click', () => {
        maximizedImageOverlay.style.display = 'none';
    });

    // Recipe event listener (main form)
    // Recipe dropdown handler
    const editRecipeBtn = document.getElementById('editRecipeBtn');

    document.getElementById('recipe').addEventListener('change', async function() {
        const value = this.value;

        if (value === '__editor__') {
            // Open recipe editor for new recipe
            await openRecipeEditor();
            this.value = ''; // Reset dropdown
            editRecipeBtn.style.display = 'none'; // Hide edit button
        } else if (value === '__import__') {
            // Import recipe from file
            await importRecipe();
            this.value = ''; // Reset dropdown
            editRecipeBtn.style.display = 'none'; // Hide edit button
        } else if (value === '__preview__') {
            // Open recipe preview browser
            await openRecipePreview();
            this.value = ''; // Reset dropdown
            editRecipeBtn.style.display = 'none'; // Hide edit button
        } else if (value.startsWith('user:')) {
            // Load user recipe
            const recipeId = value.substring(5); // Remove 'user:' prefix

            // Show edit button for user recipes
            editRecipeBtn.style.display = 'block';

            const result = await loadUserRecipeYaml(recipeId);
            if (result.success) {
                const settings = result.recipe.settings || {};

                // Populate form with recipe settings
                if (settings.stacking) document.getElementById('stacking').value = settings.stacking;
                if (settings.quality !== undefined) document.getElementById('quality').value = settings.quality;
                if (settings.png_compress_level !== undefined) document.getElementById('pngCompressLevel').value = settings.png_compress_level;
                if (settings.tiff_compression) document.getElementById('tiffCompression').value = settings.tiff_compression;
                if (settings.trail_length !== undefined) document.getElementById('trailLength').value = settings.trail_length;
                if (settings.step !== undefined) document.getElementById('frameInterval').value = settings.step;
                if (settings.trail_gradient !== undefined) document.getElementById('trailGradient').checked = settings.trail_gradient;
                if (settings.gradient_decay !== undefined) document.getElementById('gradientDecay').value = settings.gradient_decay;
                if (settings.gradient_plateau !== undefined) document.getElementById('gradientPlateau').value = settings.gradient_plateau;
                if (settings.fade_out !== undefined) document.getElementById('fadeOut').checked = settings.fade_out;
            } else {
                console.error('Error loading user recipe:', result.error);
                alert('Failed to load recipe: ' + result.error);
            }
        } else {
            // Built-in recipe or custom settings
            loadMainFormRecipe();
            editRecipeBtn.style.display = 'none'; // Hide edit button
        }
    });

    // Edit recipe button handler
    editRecipeBtn.addEventListener('click', async () => {
        const recipeSelect = document.getElementById('recipe');
        const value = recipeSelect.value;

        if (value.startsWith('user:')) {
            const recipeId = value.substring(5); // Remove 'user:' prefix
            await openRecipeEditor(recipeId); // Open editor in edit mode
        }
    });

    // Preferences event listeners
    document.getElementById('preferencesBtn').addEventListener('click', openPreferences);
    document.getElementById('prefRecipe').addEventListener('change', loadRecipeTemplate);
    document.getElementById('savePreferences').addEventListener('click', savePreferences);
    document.getElementById('cancelPreferences').addEventListener('click', closePreferences);
    document.getElementById('resetPreferences').addEventListener('click', resetPreferences);

    // Recipe editor event listeners
    document.getElementById('saveRecipe').addEventListener('click', saveRecipe);
    document.getElementById('exportRecipe').addEventListener('click', exportRecipe);
    document.getElementById('duplicateRecipe').addEventListener('click', duplicateRecipe);
    document.getElementById('deleteRecipe').addEventListener('click', deleteRecipe);
    document.getElementById('cancelRecipeEditor').addEventListener('click', closeRecipeEditor);

    // Recipe preview event listeners
    document.getElementById('previewRecipeSelector').addEventListener('change', async function() {
        await updatePreviewContent(this.value);
    });
    document.getElementById('recipeSearchInput').addEventListener('input', filterRecipes);
    document.getElementById('loadFromPreview').addEventListener('click', loadFromPreview);
    document.getElementById('editFromPreview').addEventListener('click', editFromPreview);
    document.getElementById('closePreview').addEventListener('click', closeRecipePreview);

    // ESC key to close dialogs
    document.addEventListener('keydown', (event) => {
        // Cmd/Ctrl + Shift + Q = Open Queue Dialog
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'q') {
            event.preventDefault();
            openQueueDialog();
            return;
        }

        if (event.key === 'Escape') {
            // Check which dialog is open and close it
            if (maximizedImageOverlay.style.display === 'flex') {
                maximizedImageOverlay.style.display = 'none';
            } else if (!document.getElementById('queueDialog').classList.contains('hidden')) {
                closeQueueDialog();
            } else if (document.getElementById('recipeEditorDialog').style.display === 'block') {
                closeRecipeEditor();
            } else if (document.getElementById('recipePreviewDialog').style.display === 'block') {
                closeRecipePreview();
            } else if (document.getElementById('preferencesDialog').style.display === 'block') {
                closePreferences();
            } else if (document.getElementById('progressDialog').style.display === 'block') {
                // Only allow closing progress dialog if stacking is complete (cancel button hidden)
                if (cancelStackingButton.style.display === 'none') {
                    overlay.style.display = 'none';
                    progressDialog.style.display = 'none';
                    startButton.disabled = false;
                }
            }
        }
    });

    // Listen for frame selection changes
    document.getElementById('startFrame').addEventListener('input', updateFileSelection);
    document.getElementById('endFrame').addEventListener('input', updateFileSelection);
    document.getElementById('frameInterval').addEventListener('input', updateFileSelection);

    // Listen for stacking progress
    await listen('stacking-progress', (event) => {
        const data = event.payload;
        if (data.type === 'progress') {
            const percent = Math.round((data.current / data.total) * 100);
            progressFill.style.width = `${percent}%`;
            progressFill.textContent = `${percent}%`;
            progressText.textContent = `Processing frame ${data.current} of ${data.total}`;
            if (data.file) {
                progressText.textContent += ` - ${data.file}`;
            }
        } else if (data.type === 'complete') {
            progressFill.style.width = '100%';
            progressFill.textContent = '100%';
            progressText.textContent = 'Stacking complete!';
            openOutputButton.style.display = 'block';
        }
    });
}

// Preferences System
const defaultPreferences = {
    prefix: 'stacked-',
    stacking: 'maximum',
    quality: 100,
    pngCompressLevel: 6,
    tiffCompression: 'deflate',
    theme: 'vibrant'
};

// Built-in recipe templates (full settings from recipe YAML files)
const recipeTemplates = {
    'stars': {
        stacking: 'maximum',
        trail_length: 30,
        fade_out: true,
        quality: 95,
        frame_interval: 1
    },
    'murmurations': {
        stacking: 'minimum',
        trail_length: 15,
        trail_gradient: true,
        quality: 90,
        frame_interval: 1
    },
    'traffic': {
        stacking: 'maximum',
        trail_length: 20,
        fade_out: true,
        quality: 92,
        frame_interval: 1
    },
    'timelapse': {
        stacking: 'mean',
        trail_length: 5,
        quality: 90,
        frame_interval: 1
    },
    'fireworks': {
        stacking: 'maximum',
        trail_length: 10,
        quality: 95,
        frame_interval: 1
    },
    'noise-reduction': {
        stacking: 'mean',
        trail_length: 0,
        fade_out: false,
        quality: 95,
        frame_interval: 1
    }
};

function loadPreferences() {
    try {
        const saved = localStorage.getItem('userPreferences');
        const prefs = saved ? JSON.parse(saved) : defaultPreferences;
        applyPreferences(prefs);
        return prefs;
    } catch (error) {
        console.error('Failed to load preferences:', error);
        return defaultPreferences;
    }
}

function applyPreferences(prefs) {
    // Apply to main form fields
    document.getElementById('prefix').value = prefs.prefix || defaultPreferences.prefix;
    document.getElementById('stacking').value = prefs.stacking || defaultPreferences.stacking;
    document.getElementById('quality').value = prefs.quality || defaultPreferences.quality;
    document.getElementById('pngCompressLevel').value = prefs.pngCompressLevel || defaultPreferences.pngCompressLevel;
    document.getElementById('tiffCompression').value = prefs.tiffCompression || defaultPreferences.tiffCompression;

    // Apply theme
    applyTheme(prefs.theme || defaultPreferences.theme);
}

function applyTheme(themeName) {
    // Set data-theme attribute on body element
    document.body.setAttribute('data-theme', themeName);

    // Save to localStorage for persistence
    try {
        const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
        prefs.theme = themeName;
        localStorage.setItem('userPreferences', JSON.stringify(prefs));
    } catch (error) {
        console.error('Failed to save theme preference:', error);
    }
}

function loadMainFormRecipe() {
    const recipeSelect = document.getElementById('recipe');
    const recipeId = recipeSelect.value;

    if (!recipeId || !recipeTemplates[recipeId]) {
        return;
    }

    const recipe = recipeTemplates[recipeId];

    // Populate main form fields with recipe values
    if (recipe.stacking) {
        document.getElementById('stacking').value = recipe.stacking;
    }
    if (recipe.quality !== undefined) {
        document.getElementById('quality').value = recipe.quality;
    }
    if (recipe.trail_length !== undefined) {
        document.getElementById('trailLength').value = recipe.trail_length;
    }
    if (recipe.frame_interval !== undefined) {
        document.getElementById('frameInterval').value = recipe.frame_interval;
    }
    if (recipe.fade_out !== undefined) {
        document.getElementById('fadeOut').checked = recipe.fade_out;
    }
    if (recipe.trail_gradient !== undefined) {
        document.getElementById('trailGradient').checked = recipe.trail_gradient;
    }
}

function loadRecipeTemplate() {
    const recipeSelect = document.getElementById('prefRecipe');
    const recipeId = recipeSelect.value;

    if (!recipeId || !recipeTemplates[recipeId]) {
        return;
    }

    const recipe = recipeTemplates[recipeId];

    // Populate preference fields with recipe values (only quality and stacking for prefs)
    if (recipe.stacking) {
        document.getElementById('prefStacking').value = recipe.stacking;
    }
    if (recipe.quality !== undefined) {
        document.getElementById('prefQuality').value = recipe.quality;
    }

    // Reset recipe selector after loading
    recipeSelect.value = '';
}

function openPreferences() {
    const prefs = loadPreferences();

    // Reset recipe selector
    document.getElementById('prefRecipe').value = '';

    // Populate preferences dialog with current values (with fallbacks to defaults)
    document.getElementById('prefPrefix').value = prefs.prefix || defaultPreferences.prefix;
    document.getElementById('prefStacking').value = prefs.stacking || defaultPreferences.stacking;
    document.getElementById('prefQuality').value = prefs.quality || defaultPreferences.quality;
    document.getElementById('prefPngCompress').value = prefs.pngCompressLevel || defaultPreferences.pngCompressLevel;
    document.getElementById('prefTiffCompression').value = prefs.tiffCompression || defaultPreferences.tiffCompression;
    document.getElementById('prefTheme').value = prefs.theme || defaultPreferences.theme;

    // Show dialog
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('preferencesDialog').style.display = 'block';
}

function closePreferences() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('preferencesDialog').style.display = 'none';
}

function savePreferences() {
    const prefs = {
        prefix: document.getElementById('prefPrefix').value,
        stacking: document.getElementById('prefStacking').value,
        quality: parseInt(document.getElementById('prefQuality').value),
        pngCompressLevel: parseInt(document.getElementById('prefPngCompress').value),
        tiffCompression: document.getElementById('prefTiffCompression').value,
        theme: document.getElementById('prefTheme').value
    };

    try {
        localStorage.setItem('userPreferences', JSON.stringify(prefs));
        applyPreferences(prefs);
        closePreferences();
    } catch (error) {
        console.error('Failed to save preferences:', error);
        alert('Failed to save preferences: ' + error.message);
    }
}

function resetPreferences() {
    if (confirm('Reset all preferences to defaults?')) {
        localStorage.removeItem('userPreferences');
        applyPreferences(defaultPreferences);

        // Update preferences dialog
        document.getElementById('prefPrefix').value = defaultPreferences.prefix;
        document.getElementById('prefStacking').value = defaultPreferences.stacking;
        document.getElementById('prefQuality').value = defaultPreferences.quality;
        document.getElementById('prefPngCompress').value = defaultPreferences.pngCompressLevel;
        document.getElementById('prefTiffCompression').value = defaultPreferences.tiffCompression;
        document.getElementById('prefTheme').value = defaultPreferences.theme;
    }
}

async function browseInputDirectory() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Input Directory'
        });

        if (selected) {
            inputDirPath = selected;
            inputDirEl.value = selected;

            // Validate directory
            inputValidationEl.textContent = 'Validating directory (max 30s)...';
            inputValidationEl.className = 'validation-message';

            const result = await invokeWithTimeout('validate_directory', { path: selected }, 30000);

            if (result.valid) {
                const formatText = result.detected_formats && result.detected_formats.length > 0
                    ? ` (${result.detected_formats.map(f => f.toUpperCase()).join(', ')})`
                    : '';
                inputValidationEl.textContent = `Found ${result.image_count} images${formatText}`;
                inputValidationEl.className = 'validation-message success';
                updateStartButtonState();

                // Show/hide format-specific controls based on detected formats
                updateFormatControls(result.detected_formats || []);

                // Load file list
                await loadFileList(selected);
            } else {
                inputValidationEl.textContent = result.error;
                inputValidationEl.className = 'validation-message error';
                startButton.disabled = true;
                // Hide all format controls when validation fails
                updateFormatControls([]);
            }
        }
    } catch (error) {
        console.error('Error selecting directory:', error);
        inputValidationEl.textContent = error.toString();
        inputValidationEl.className = 'validation-message error';
    }
}

async function loadFileList(dirPath) {
    try {
        fileListTitleEl.textContent = 'Loading files (max 30s)...';
        const files = await invokeWithTimeout('get_file_list', { path: dirPath }, 30000);
        allFiles = files;
        updateFileSelection();
    } catch (error) {
        console.error('Error loading file list:', error);
        fileListTitleEl.textContent = 'Error loading files';
        fileListEl.innerHTML = `<div class="file-list-empty">Error: ${error}</div>`;
    }
}

function updateFormatControls(detectedFormats) {
    // Get all format control groups
    const formatSection = document.getElementById('formatOptionsSection');
    const jpegControl = document.getElementById('quality').closest('.form-group');
    const pngControl = document.getElementById('pngCompressLevel').closest('.form-group');
    const tiffControl = document.getElementById('tiffCompression').closest('.form-group');

    // If no formats detected, hide entire section
    if (!detectedFormats || detectedFormats.length === 0) {
        if (formatSection) formatSection.style.display = 'none';
        return;
    }

    // Show the format options section
    if (formatSection) formatSection.style.display = 'block';

    // Show controls based on detected formats
    const hasJpeg = detectedFormats.includes('jpeg');
    const hasPng = detectedFormats.includes('png');
    const hasTiff = detectedFormats.includes('tiff');

    if (jpegControl) jpegControl.style.display = hasJpeg ? 'block' : 'none';
    if (pngControl) pngControl.style.display = hasPng ? 'block' : 'none';
    if (tiffControl) tiffControl.style.display = hasTiff ? 'block' : 'none';
}

function calculateSelectedIndices() {
    if (allFiles.length === 0) return new Set();

    const startFrame = parseInt(document.getElementById('startFrame').value) || 0;
    const endFrame = parseInt(document.getElementById('endFrame').value) || allFiles.length - 1;
    const frameInterval = parseInt(document.getElementById('frameInterval').value) || 1;

    const selected = new Set();
    for (let i = startFrame; i <= Math.min(endFrame, allFiles.length - 1); i += frameInterval) {
        selected.add(i);
    }
    return selected;
}

function updateFileSelection() {
    if (allFiles.length === 0) return;

    selectedIndices = calculateSelectedIndices();
    const selectedCount = selectedIndices.size;
    fileListTitleEl.textContent = `${allFiles.length} files total, ${selectedCount} selected`;

    renderFileList();
}

function renderFileList() {
    if (allFiles.length === 0) {
        fileListEl.innerHTML = '<div class="file-list-empty">No files found</div>';
        return;
    }

    fileListEl.innerHTML = allFiles.map(file => {
        const isSelected = selectedIndices.has(file.index);
        return `
            <div class="file-item ${isSelected ? 'selected' : 'unselected'}" data-index="${file.index}" data-path="${file.path}">
                <span class="file-item-index">${file.index}</span>
                <span class="file-item-name">${file.filename}</span>
            </div>
        `;
    }).join('');

    // Add click handlers for preview
    fileListEl.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', () => {
            const path = item.dataset.path;
            previewImage(path);
        });
    });
}

function previewImage(imagePath) {
    try {
        console.log('Preview image path:', imagePath);

        // Extract filename from path
        const filename = imagePath.split(/[/\\]/).pop();
        previewFilenameEl.textContent = filename;

        // Convert file path to file URL for Tauri v2
        const imageUrl = convertFileSrc(imagePath);
        console.log('Converted image URL:', imageUrl);

        previewContentEl.innerHTML = `
            <img src="${imageUrl}" class="preview-image" alt="Preview" onerror="console.error('Image failed to load:', '${imageUrl}'); this.parentElement.innerHTML='<div class=\\'preview-empty\\'>Failed to load image</div>'">
            <button class="maximize-button" id="maximizeButton">🔍 Maximize</button>
        `;

        // Add click handler for maximize button
        const maximizeButton = document.getElementById('maximizeButton');
        if (maximizeButton) {
            maximizeButton.addEventListener('click', () => {
                maximizedImage.src = imageUrl;
                maximizedImageOverlay.style.display = 'flex';
            });
        }

        // Add click handler for image itself
        const previewImg = previewContentEl.querySelector('.preview-image');
        if (previewImg) {
            previewImg.addEventListener('click', () => {
                maximizedImage.src = imageUrl;
                maximizedImageOverlay.style.display = 'flex';
            });
        }
    } catch (error) {
        console.error('Error loading preview:', error);
        previewContentEl.innerHTML = '<div class="preview-empty">Error loading preview</div>';
        previewFilenameEl.textContent = '';
    }
}

async function browseOutputDirectory() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Output Directory'
        });

        if (selected) {
            outputDirPath = selected;
            outputDirEl.value = selected;
            updateStartButtonState();
        }
    } catch (error) {
        console.error('Error selecting output directory:', error);
    }
}

function updateStartButtonState() {
    startButton.disabled = !(inputDirPath && outputDirPath);
    // Add to Queue button only needs input directory
    const addToQueueBtn = document.getElementById('addToQueueBtn');
    if (addToQueueBtn) {
        addToQueueBtn.disabled = !inputDirPath;
    }
}

async function startStacking() {
    // Check if batch processing is already running
    if (isBatchProcessing) {
        alert('Batch processing is already running. Please wait or cancel the current batch.');
        return;
    }

    // Collect configuration
    const config = {
        input_path: inputDirPath,
        output_path: outputDirPath,
        prefix: document.getElementById('prefix').value,
        stacking: document.getElementById('stacking').value,
        start_frame: document.getElementById('startFrame').value ? parseInt(document.getElementById('startFrame').value) : null,
        end_frame: document.getElementById('endFrame').value ? parseInt(document.getElementById('endFrame').value) : null,
        frame_interval: parseInt(document.getElementById('frameInterval').value),
        trail_length: parseInt(document.getElementById('trailLength').value),
        trail_gradient: document.getElementById('trailGradient').checked,
        gradient_decay: parseFloat(document.getElementById('gradientDecay').value),
        gradient_plateau: parseInt(document.getElementById('gradientPlateau').value),
        fade_out: document.getElementById('fadeOut').checked,
        quality: parseInt(document.getElementById('quality').value),
        png_compress_level: parseInt(document.getElementById('pngCompressLevel').value),
        tiff_compression: document.getElementById('tiffCompression').value
    };

    // Show progress dialog
    overlay.style.display = 'block';
    progressDialog.style.display = 'block';
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    progressText.textContent = 'Starting...';
    openOutputButton.style.display = 'none';
    cancelStackingButton.style.display = 'block';
    startButton.disabled = true;

    try {
        const result = await invoke('start_stacking', { config });

        if (result.success) {
            outputDirFromStack = result.output_dir;
            progressText.textContent = 'Stacking complete!';
            cancelStackingButton.style.display = 'none';
            openOutputButton.style.display = 'block';
        } else {
            progressText.textContent = `Error: ${result.error}`;
            cancelStackingButton.style.display = 'none';
            setTimeout(() => {
                overlay.style.display = 'none';
                progressDialog.style.display = 'none';
                startButton.disabled = false;
            }, 3000);
        }
    } catch (error) {
        console.error('Stacking error:', error);
        progressText.textContent = `Error: ${error}`;
        cancelStackingButton.style.display = 'none';
        setTimeout(() => {
            overlay.style.display = 'none';
            progressDialog.style.display = 'none';
            startButton.disabled = false;
        }, 3000);
    }
}

async function openOutputFolder() {
    try {
        await invoke('open_folder', { path: outputDirFromStack });

        // Close dialog after opening
        overlay.style.display = 'none';
        progressDialog.style.display = 'none';
        startButton.disabled = false;
    } catch (error) {
        console.error('Error opening folder:', error);
        alert(`Failed to open folder: ${error}`);
    }
}

async function cancelStacking() {
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to cancel the stacking operation?');

    if (!confirmed) {
        return;
    }

    try {
        await invoke('cancel_stacking');

        // Update UI
        progressText.textContent = 'Stacking cancelled';
        cancelStackingButton.style.display = 'none';

        // Close dialog after a brief delay
        setTimeout(() => {
            overlay.style.display = 'none';
            progressDialog.style.display = 'none';
            startButton.disabled = false;
        }, 1500);
    } catch (error) {
        console.error('Error cancelling stacking:', error);
        progressText.textContent = `Failed to cancel: ${error}`;
        cancelStackingButton.style.display = 'none';
    }
}

// Recipe Editor Functions
let currentEditingRecipeId = null;

// Generate a simple UUID v4
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function openRecipeEditor(recipeId = null) {
    if (recipeId) {
        // Edit mode - load existing recipe
        currentEditingRecipeId = recipeId;
        document.getElementById('recipeEditorTitle').textContent = 'Edit Recipe';
        document.getElementById('exportRecipe').style.display = 'inline-block';
        document.getElementById('duplicateRecipe').style.display = 'inline-block';
        document.getElementById('deleteRecipe').style.display = 'inline-block';

        const result = await loadUserRecipeYaml(recipeId);
        if (!result.success) {
            console.error('Error loading recipe:', result.error);
            alert('Failed to load recipe: ' + result.error);
            return;
        }

        const recipe = result.recipe;

        // Populate form with recipe data
        document.getElementById('recipeName').value = recipe.name || '';
        document.getElementById('recipeDescription').value = recipe.description || '';

        const settings = recipe.settings || {};
        document.getElementById('recipeStacking').value = settings.stacking || 'maximum';
        document.getElementById('recipeQuality').value = settings.quality || 95;
        document.getElementById('recipePngCompress').value = settings.png_compress_level || 6;
        document.getElementById('recipeTiffCompression').value = settings.tiff_compression || 'deflate';
        document.getElementById('recipeTrailLength').value = settings.trail_length || 0;
        document.getElementById('recipeFrameInterval').value = settings.step || 1;
        document.getElementById('recipeTrailGradient').checked = settings.trail_gradient || false;
        document.getElementById('recipeGradientDecay').value = settings.gradient_decay || 0.85;
        document.getElementById('recipeGradientPlateau').value = settings.gradient_plateau || 0;
        document.getElementById('recipeFadeOut').checked = settings.fade_out || false;
    } else {
        // New recipe mode - generate a new UUID
        currentEditingRecipeId = generateUUID();
        document.getElementById('recipeEditorTitle').textContent = 'New Recipe';
        document.getElementById('exportRecipe').style.display = 'none';
        document.getElementById('duplicateRecipe').style.display = 'none';
        document.getElementById('deleteRecipe').style.display = 'none';

        // Clear form
        document.getElementById('recipeName').value = '';
        document.getElementById('recipeDescription').value = '';
        document.getElementById('recipeStacking').value = 'maximum';
        document.getElementById('recipeQuality').value = 95;
        document.getElementById('recipePngCompress').value = 6;
        document.getElementById('recipeTiffCompression').value = 'deflate';
        document.getElementById('recipeTrailLength').value = 0;
        document.getElementById('recipeFrameInterval').value = 1;
        document.getElementById('recipeTrailGradient').checked = false;
        document.getElementById('recipeGradientDecay').value = 0.85;
        document.getElementById('recipeGradientPlateau').value = 0;
        document.getElementById('recipeFadeOut').checked = false;
    }

    // Show dialog
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('recipeEditorDialog').style.display = 'block';

    // Set up validation listeners
    setupRecipeValidation();
}

function closeRecipeEditor() {
    currentEditingRecipeId = null;
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('recipeEditorDialog').style.display = 'none';

    // Clear validation errors
    clearRecipeValidationErrors();
}

// Recipe validation functions
function validateRecipeField(fieldId, value) {
    const validations = {
        'recipeQuality': {
            min: 1,
            max: 100,
            message: 'Quality must be between 1 and 100'
        },
        'recipePngCompress': {
            min: 0,
            max: 9,
            message: 'PNG compression must be between 0 and 9'
        },
        'recipeGradientDecay': {
            min: 0,
            max: 1,
            message: 'Gradient decay must be between 0.0 and 1.0'
        },
        'recipeTrailLength': {
            min: 0,
            max: null,
            message: 'Trail length must be 0 or greater'
        },
        'recipeFrameInterval': {
            min: 1,
            max: null,
            message: 'Frame interval must be 1 or greater'
        },
        'recipeGradientPlateau': {
            min: 0,
            max: null,
            message: 'Gradient plateau must be 0 or greater'
        }
    };

    const validation = validations[fieldId];
    if (!validation) return { valid: true };

    const numValue = parseFloat(value);

    if (isNaN(numValue)) {
        return { valid: false, message: 'Must be a valid number' };
    }

    if (validation.min !== null && numValue < validation.min) {
        return { valid: false, message: validation.message };
    }

    if (validation.max !== null && numValue > validation.max) {
        return { valid: false, message: validation.message };
    }

    return { valid: true };
}

function showValidationError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    // Add error class to field
    field.classList.add('validation-error');

    // Create or update error message
    let errorEl = field.parentElement.querySelector('.field-error-message');
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'field-error-message';
        field.parentElement.appendChild(errorEl);
    }
    errorEl.textContent = message;
}

function clearFieldValidationError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    // Remove error class
    field.classList.remove('validation-error');

    // Remove error message
    const errorEl = field.parentElement.querySelector('.field-error-message');
    if (errorEl) {
        errorEl.remove();
    }
}

function clearRecipeValidationErrors() {
    document.querySelectorAll('.validation-error').forEach(el => {
        el.classList.remove('validation-error');
    });
    document.querySelectorAll('.field-error-message').forEach(el => {
        el.remove();
    });
}

function validateAllRecipeFields() {
    const fieldsToValidate = [
        'recipeQuality',
        'recipePngCompress',
        'recipeGradientDecay',
        'recipeTrailLength',
        'recipeFrameInterval',
        'recipeGradientPlateau'
    ];

    let allValid = true;

    fieldsToValidate.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        const result = validateRecipeField(fieldId, field.value);
        if (!result.valid) {
            showValidationError(fieldId, result.message);
            allValid = false;
        } else {
            clearFieldValidationError(fieldId);
        }
    });

    // Also validate recipe name
    const recipeName = document.getElementById('recipeName').value.trim();
    if (!recipeName) {
        showValidationError('recipeName', 'Recipe name is required');
        allValid = false;
    } else {
        clearFieldValidationError('recipeName');
    }

    return allValid;
}

function setupRecipeValidation() {
    const fieldsToValidate = [
        'recipeName',
        'recipeQuality',
        'recipePngCompress',
        'recipeGradientDecay',
        'recipeTrailLength',
        'recipeFrameInterval',
        'recipeGradientPlateau'
    ];

    fieldsToValidate.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        // Remove any existing listener (to avoid duplicates)
        field.removeEventListener('input', validateOnInput);
        field.removeEventListener('blur', validateOnBlur);

        // Add validation on input
        field.addEventListener('input', validateOnInput);

        // Add validation on blur
        field.addEventListener('blur', validateOnBlur);
    });
}

function validateOnInput(event) {
    const fieldId = event.target.id;

    if (fieldId === 'recipeName') {
        const value = event.target.value.trim();
        if (value) {
            clearFieldValidationError(fieldId);
        }
    } else {
        const result = validateRecipeField(fieldId, event.target.value);
        if (result.valid) {
            clearFieldValidationError(fieldId);
        }
    }
}

function validateOnBlur(event) {
    const fieldId = event.target.id;

    if (fieldId === 'recipeName') {
        const value = event.target.value.trim();
        if (!value) {
            showValidationError(fieldId, 'Recipe name is required');
        } else {
            clearFieldValidationError(fieldId);
        }
    } else {
        const result = validateRecipeField(fieldId, event.target.value);
        if (!result.valid) {
            showValidationError(fieldId, result.message);
        } else {
            clearFieldValidationError(fieldId);
        }
    }
}

async function saveRecipe() {
    // Validate all fields before saving
    if (!validateAllRecipeFields()) {
        return; // Don't save if validation fails
    }

    const recipeName = document.getElementById('recipeName').value.trim();
    const recipeDescription = document.getElementById('recipeDescription').value.trim();

    // Use the currentEditingRecipeId (either loaded or newly generated UUID)
    const recipeId = currentEditingRecipeId;

    // Build YAML content
    const settings = {
        stacking: document.getElementById('recipeStacking').value,
        quality: parseInt(document.getElementById('recipeQuality').value),
        png_compress_level: parseInt(document.getElementById('recipePngCompress').value),
        tiff_compression: document.getElementById('recipeTiffCompression').value,
        trail_length: parseInt(document.getElementById('recipeTrailLength').value),
        step: parseInt(document.getElementById('recipeFrameInterval').value),
        trail_gradient: document.getElementById('recipeTrailGradient').checked,
        gradient_decay: parseFloat(document.getElementById('recipeGradientDecay').value),
        gradient_plateau: parseInt(document.getElementById('recipeGradientPlateau').value),
        fade_out: document.getElementById('recipeFadeOut').checked
    };

    const yamlContent = `# ${recipeName}
# ${recipeDescription}

name: "${recipeName}"
description: "${recipeDescription}"

settings:
  stacking: ${settings.stacking}
  quality: ${settings.quality}
  png_compress_level: ${settings.png_compress_level}
  tiff_compression: ${settings.tiff_compression}
  trail_length: ${settings.trail_length}
  step: ${settings.step}
  trail_gradient: ${settings.trail_gradient}
  gradient_decay: ${settings.gradient_decay}
  gradient_plateau: ${settings.gradient_plateau}
  fade_out: ${settings.fade_out}
`;

    try {
        await invoke('save_user_recipe', { recipeId, content: yamlContent });
        await refreshRecipeDropdown();
        closeRecipeEditor();
    } catch (error) {
        console.error('Error saving recipe:', error);
        alert('Failed to save recipe: ' + error);
    }
}

async function deleteRecipe() {
    if (!currentEditingRecipeId) {
        return;
    }

    const recipeName = document.getElementById('recipeName').value.trim() || 'this recipe';

    if (!confirm(`Delete "${recipeName}"? This cannot be undone.`)) {
        return;
    }

    try {
        await invoke('delete_user_recipe', { recipeId: currentEditingRecipeId });
        await refreshRecipeDropdown();
        closeRecipeEditor();
    } catch (error) {
        console.error('Error deleting recipe:', error);
        alert('Failed to delete recipe: ' + error);
    }
}

async function duplicateRecipe() {
    if (!currentEditingRecipeId) {
        return;
    }

    // Get current recipe name and append " (Copy)"
    const originalName = document.getElementById('recipeName').value.trim();
    const newName = originalName ? `${originalName} (Copy)` : 'Recipe (Copy)';

    // Generate new UUID for the duplicate
    const newRecipeId = generateUUID();

    // Gather all current form values
    const recipeDescription = document.getElementById('recipeDescription').value.trim();
    const settings = {
        stacking: document.getElementById('recipeStacking').value,
        quality: parseInt(document.getElementById('recipeQuality').value),
        png_compress_level: parseInt(document.getElementById('recipePngCompress').value),
        tiff_compression: document.getElementById('recipeTiffCompression').value,
        trail_length: parseInt(document.getElementById('recipeTrailLength').value),
        step: parseInt(document.getElementById('recipeFrameInterval').value),
        trail_gradient: document.getElementById('recipeTrailGradient').checked,
        gradient_decay: parseFloat(document.getElementById('recipeGradientDecay').value),
        gradient_plateau: parseInt(document.getElementById('recipeGradientPlateau').value),
        fade_out: document.getElementById('recipeFadeOut').checked
    };

    // Build YAML content for the duplicate
    const yamlContent = `name: ${newName}
description: ${recipeDescription}
settings:
  stacking: ${settings.stacking}
  quality: ${settings.quality}
  png_compress_level: ${settings.png_compress_level}
  tiff_compression: ${settings.tiff_compression}
  trail_length: ${settings.trail_length}
  step: ${settings.step}
  trail_gradient: ${settings.trail_gradient}
  gradient_decay: ${settings.gradient_decay}
  gradient_plateau: ${settings.gradient_plateau}
  fade_out: ${settings.fade_out}
`;

    try {
        // Save the duplicate recipe
        await invoke('save_user_recipe', { recipeId: newRecipeId, content: yamlContent });
        await refreshRecipeDropdown();

        // Re-open the editor with the new duplicate recipe
        closeRecipeEditor();
        await openRecipeEditor(newRecipeId);
    } catch (error) {
        console.error('Error duplicating recipe:', error);
        alert('Failed to duplicate recipe: ' + error);
    }
}

async function exportRecipe() {
    if (!currentEditingRecipeId) {
        return;
    }

    const recipeName = document.getElementById('recipeName').value.trim() || 'recipe';
    const recipeDescription = document.getElementById('recipeDescription').value.trim();

    // Gather all current form values
    const settings = {
        stacking: document.getElementById('recipeStacking').value,
        quality: parseInt(document.getElementById('recipeQuality').value),
        png_compress_level: parseInt(document.getElementById('recipePngCompress').value),
        tiff_compression: document.getElementById('recipeTiffCompression').value,
        trail_length: parseInt(document.getElementById('recipeTrailLength').value),
        step: parseInt(document.getElementById('recipeFrameInterval').value),
        trail_gradient: document.getElementById('recipeTrailGradient').checked,
        gradient_decay: parseFloat(document.getElementById('recipeGradientDecay').value),
        gradient_plateau: parseInt(document.getElementById('recipeGradientPlateau').value),
        fade_out: document.getElementById('recipeFadeOut').checked
    };

    // Build YAML content
    const yamlContent = `# ${recipeName}
# ${recipeDescription}

name: "${recipeName}"
description: "${recipeDescription}"

settings:
  stacking: ${settings.stacking}
  quality: ${settings.quality}
  png_compress_level: ${settings.png_compress_level}
  tiff_compression: ${settings.tiff_compression}
  trail_length: ${settings.trail_length}
  step: ${settings.step}
  trail_gradient: ${settings.trail_gradient}
  gradient_decay: ${settings.gradient_decay}
  gradient_plateau: ${settings.gradient_plateau}
  fade_out: ${settings.fade_out}
`;

    try {
        // Generate safe filename from recipe name
        const safeFilename = recipeName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const defaultPath = `${safeFilename}.yaml`;

        // Use Tauri dialog to save file
        const { save } = window.__TAURI__.dialog;
        const filePath = await save({
            defaultPath: defaultPath,
            filters: [{
                name: 'YAML Recipe',
                extensions: ['yaml', 'yml']
            }]
        });

        if (filePath) {
            // Write file using Rust command
            await invoke('export_user_recipe', {
                recipeId: currentEditingRecipeId,
                exportPath: filePath
            });
            alert(`Recipe exported successfully to:\n${filePath}`);
        }
    } catch (error) {
        console.error('Error exporting recipe:', error);
        alert('Failed to export recipe: ' + error);
    }
}

async function importRecipe() {
    try {
        // Use Tauri dialog to open file
        const { open } = window.__TAURI__.dialog;
        const filePath = await open({
            multiple: false,
            filters: [{
                name: 'YAML Recipe',
                extensions: ['yaml', 'yml']
            }]
        });

        if (!filePath) {
            return; // User cancelled
        }

        // Read file using Rust command
        const yamlContent = await invoke('import_user_recipe_from_file', {
            importPath: filePath
        });

        // Parse YAML
        let recipe;
        try {
            recipe = jsyaml.load(yamlContent);
        } catch (error) {
            console.error('Error parsing recipe YAML:', error);
            alert('Failed to parse recipe file: Invalid YAML format');
            return;
        }

        if (!recipe || !recipe.settings) {
            alert('Invalid recipe file format');
            return;
        }

        // Generate new UUID for imported recipe
        const newRecipeId = generateUUID();

        // Get recipe name, add " (Imported)" if not already present
        let recipeName = recipe.name || 'Imported Recipe';
        if (!recipeName.includes('(Imported)')) {
            recipeName += ' (Imported)';
        }

        // Update the recipe name in the YAML
        const updatedYaml = yamlContent.replace(
            /^name:\s*"?.*"?$/m,
            `name: "${recipeName}"`
        );

        // Save as new recipe
        await invoke('save_user_recipe', { recipeId: newRecipeId, content: updatedYaml });
        await refreshRecipeDropdown();

        // Open the editor with the imported recipe for review
        await openRecipeEditor(newRecipeId);

        alert(`Recipe "${recipeName}" imported successfully!`);
    } catch (error) {
        console.error('Error importing recipe:', error);
        alert('Failed to import recipe: ' + error);
    }
}

// Recipe Preview Functions
let currentPreviewRecipeId = null;

async function openRecipePreview() {
    try {
        // Populate the preview selector dropdown
        const previewSelector = document.getElementById('previewRecipeSelector');
        previewSelector.innerHTML = '<option value="">Choose a recipe...</option>';

        // Add built-in recipes
        const builtInRecipes = [
            { id: 'stars', name: 'Star Trails' },
            { id: 'murmurations', name: 'Bird Murmurations' },
            { id: 'traffic', name: 'Traffic Light Trails' },
            { id: 'timelapse', name: 'Time-Lapse' },
            { id: 'fireworks', name: 'Fireworks' },
            { id: 'noise-reduction', name: 'Noise Reduction' }
        ];

        builtInRecipes.forEach(recipe => {
            const option = document.createElement('option');
            option.value = `builtin:${recipe.id}`;
            option.textContent = recipe.name;
            previewSelector.appendChild(option);
        });

        // Get and add user recipes
        const userRecipes = await invoke('list_user_recipes');

        if (userRecipes.length > 0) {
            // Add divider before user recipes
            const divider = document.createElement('option');
            divider.disabled = true;
            divider.textContent = '────────────';
            previewSelector.appendChild(divider);

            userRecipes.forEach(recipe => {
                const option = document.createElement('option');
                option.value = `user:${recipe.id}`;
                option.textContent = `${recipe.name} (User)`;
                previewSelector.appendChild(option);
            });
        }

        // Reset preview state
        currentPreviewRecipeId = null;
        document.getElementById('previewDetailsSection').style.display = 'none';
        document.getElementById('loadFromPreview').style.display = 'none';
        document.getElementById('editFromPreview').style.display = 'none';

        // Clear search input
        document.getElementById('recipeSearchInput').value = '';

        // Show dialog
        document.getElementById('overlay').style.display = 'block';
        document.getElementById('recipePreviewDialog').style.display = 'block';
    } catch (error) {
        console.error('Error opening recipe preview:', error);
        alert('Failed to open recipe preview: ' + error);
    }
}

function filterRecipes() {
    const searchInput = document.getElementById('recipeSearchInput');
    const searchText = searchInput.value.toLowerCase().trim();
    const previewSelector = document.getElementById('previewRecipeSelector');
    const options = Array.from(previewSelector.options);

    if (!searchText) {
        // Show all options if search is empty
        options.forEach(option => {
            option.style.display = '';
        });
        return;
    }

    // Track if we have visible recipes in built-in and user sections
    let hasVisibleBuiltIn = false;
    let hasVisibleUser = false;
    let inUserSection = false;

    options.forEach((option, index) => {
        // Skip the "Choose a recipe..." option
        if (index === 0) {
            option.style.display = '';
            return;
        }

        // Check if this is a divider
        if (option.disabled && option.textContent.includes('────')) {
            // We'll handle divider visibility after checking all options
            return;
        }

        // Check if we've entered the user section
        if (option.value.startsWith('user:')) {
            inUserSection = true;
        }

        // Filter recipe options based on search text
        const optionText = option.textContent.toLowerCase();
        const matches = optionText.includes(searchText);

        if (matches) {
            option.style.display = '';
            if (inUserSection) {
                hasVisibleUser = true;
            } else if (option.value.startsWith('builtin:')) {
                hasVisibleBuiltIn = true;
            }
        } else {
            option.style.display = 'none';
        }
    });

    // Show/hide divider based on whether there are visible recipes in user section
    options.forEach(option => {
        if (option.disabled && option.textContent.includes('────')) {
            // Hide the divider before user recipes if no user recipes are visible
            const nextOption = options[options.indexOf(option) + 1];
            if (nextOption && nextOption.value.startsWith('user:')) {
                option.style.display = hasVisibleUser ? '' : 'none';
            }
        }
    });
}

async function updatePreviewContent(recipeId) {
    if (!recipeId) {
        document.getElementById('previewDetailsSection').style.display = 'none';
        document.getElementById('loadFromPreview').style.display = 'none';
        document.getElementById('editFromPreview').style.display = 'none';
        return;
    }

    currentPreviewRecipeId = recipeId;

    try {
        let settings = {};
        let recipeName = '';
        let recipeDescription = '';
        let isUserRecipe = false;

        if (recipeId.startsWith('builtin:')) {
            // Handle built-in recipe
            const builtinId = recipeId.substring(8); // Remove 'builtin:' prefix
            const template = recipeTemplates[builtinId];

            if (!template) {
                throw new Error(`Built-in recipe '${builtinId}' not found`);
            }

            // Map built-in recipe IDs to display names
            const builtinNames = {
                'stars': 'Star Trails',
                'murmurations': 'Bird Murmurations',
                'traffic': 'Traffic Light Trails',
                'timelapse': 'Time-Lapse',
                'fireworks': 'Fireworks',
                'noise-reduction': 'Noise Reduction'
            };

            // Map built-in recipe IDs to descriptions
            const builtinDescriptions = {
                'stars': 'Optimized for capturing star trails with maximum brightness stacking',
                'murmurations': 'Captures flowing motion patterns with minimum brightness and gradients',
                'traffic': 'Light trails from traffic with maximum brightness and fade out',
                'timelapse': 'Smooth time-lapse sequences using mean averaging',
                'fireworks': 'Bright fireworks displays with maximum brightness stacking',
                'noise-reduction': 'Reduces noise by averaging all frames together'
            };

            recipeName = builtinNames[builtinId] || 'Built-in Recipe';
            recipeDescription = builtinDescriptions[builtinId] || 'A built-in recipe preset.';

            // Map template format to settings format
            settings = {
                stacking: template.stacking,
                quality: template.quality,
                trail_length: template.trail_length,
                step: template.frame_interval,
                trail_gradient: template.trail_gradient,
                gradient_decay: template.gradient_decay,
                gradient_plateau: template.gradient_plateau,
                fade_out: template.fade_out
            };
            isUserRecipe = false;
        } else if (recipeId.startsWith('user:')) {
            // Handle user recipe
            const userId = recipeId.substring(5); // Remove 'user:' prefix
            const result = await loadUserRecipeYaml(userId);

            if (!result.success) {
                console.error('Error loading user recipe:', result.error);
                alert('Failed to load recipe: ' + result.error);
                closeRecipePreview();
                return;
            }

            recipeName = result.recipe.name || 'Unnamed Recipe';
            recipeDescription = result.recipe.description || 'No description provided.';
            settings = result.recipe.settings || {};
            isUserRecipe = true;
        } else {
            throw new Error('Invalid recipe ID format');
        }

        // Populate preview with recipe data
        document.getElementById('previewName').textContent = recipeName;
        document.getElementById('previewDescription').textContent = recipeDescription;

        // Format stacking method
        const stackingMap = {
            'maximum': 'Maximum (brightest)',
            'minimum': 'Minimum (darkest)',
            'mean': 'Mean (average)',
            'median': 'Median'
        };
        document.getElementById('previewStacking').textContent = stackingMap[settings.stacking] || settings.stacking || 'maximum';

        // Format quality settings
        document.getElementById('previewQuality').textContent = settings.quality !== undefined ? settings.quality : '95';
        document.getElementById('previewPngCompress').textContent = settings.png_compress_level !== undefined ? settings.png_compress_level : '6';
        document.getElementById('previewTiffCompression').textContent = settings.tiff_compression || 'deflate';

        // Format trail settings
        document.getElementById('previewTrailLength').textContent = settings.trail_length !== undefined ? (settings.trail_length === 0 ? '0 (all frames)' : settings.trail_length) : '0 (all frames)';
        document.getElementById('previewFrameInterval').textContent = settings.step !== undefined ? settings.step : '1';
        document.getElementById('previewTrailGradient').textContent = settings.trail_gradient ? '✓ Enabled' : '✗ Disabled';
        document.getElementById('previewGradientDecay').textContent = settings.gradient_decay !== undefined ? settings.gradient_decay : '0.85';
        document.getElementById('previewGradientPlateau').textContent = settings.gradient_plateau !== undefined ? settings.gradient_plateau : '0';
        document.getElementById('previewFadeOut').textContent = settings.fade_out ? '✓ Enabled' : '✗ Disabled';

        // Show preview details and buttons
        document.getElementById('previewDetailsSection').style.display = 'block';
        document.getElementById('loadFromPreview').style.display = 'inline-block';

        // Only show edit button for user recipes
        if (isUserRecipe) {
            document.getElementById('editFromPreview').style.display = 'inline-block';
        } else {
            document.getElementById('editFromPreview').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading recipe preview:', error);
        alert('Failed to load recipe preview: ' + error);
    }
}

function closeRecipePreview() {
    currentPreviewRecipeId = null;
    document.getElementById('recipeSearchInput').value = '';
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('recipePreviewDialog').style.display = 'none';
}

async function loadFromPreview() {
    if (!currentPreviewRecipeId) return;

    try {
        let settings = {};

        if (currentPreviewRecipeId.startsWith('builtin:')) {
            // Handle built-in recipe
            const builtinId = currentPreviewRecipeId.substring(8); // Remove 'builtin:' prefix
            const template = recipeTemplates[builtinId];

            if (!template) {
                throw new Error(`Built-in recipe '${builtinId}' not found`);
            }

            // Map template format to settings format
            settings = {
                stacking: template.stacking,
                quality: template.quality,
                png_compress_level: template.png_compress_level,
                tiff_compression: template.tiff_compression,
                trail_length: template.trail_length,
                step: template.frame_interval,
                trail_gradient: template.trail_gradient,
                gradient_decay: template.gradient_decay,
                gradient_plateau: template.gradient_plateau,
                fade_out: template.fade_out
            };
        } else if (currentPreviewRecipeId.startsWith('user:')) {
            // Handle user recipe
            const userId = currentPreviewRecipeId.substring(5); // Remove 'user:' prefix
            const result = await loadUserRecipeYaml(userId);

            if (!result.success) {
                throw new Error('Failed to load recipe: ' + result.error);
            }

            settings = result.recipe.settings || {};
        } else {
            throw new Error('Invalid recipe ID format');
        }

        // Populate form with recipe settings
        if (settings.stacking) document.getElementById('stacking').value = settings.stacking;
        if (settings.quality !== undefined) document.getElementById('quality').value = settings.quality;
        if (settings.png_compress_level !== undefined) document.getElementById('pngCompressLevel').value = settings.png_compress_level;
        if (settings.tiff_compression) document.getElementById('tiffCompression').value = settings.tiff_compression;
        if (settings.trail_length !== undefined) document.getElementById('trailLength').value = settings.trail_length;
        if (settings.step !== undefined) document.getElementById('frameInterval').value = settings.step;
        if (settings.trail_gradient !== undefined) document.getElementById('trailGradient').checked = settings.trail_gradient;
        if (settings.gradient_decay !== undefined) document.getElementById('gradientDecay').value = settings.gradient_decay;
        if (settings.gradient_plateau !== undefined) document.getElementById('gradientPlateau').value = settings.gradient_plateau;
        if (settings.fade_out !== undefined) document.getElementById('fadeOut').checked = settings.fade_out;

        // Update the main recipe dropdown to show this recipe
        document.getElementById('recipe').value = currentPreviewRecipeId;

        // Close preview dialog
        closeRecipePreview();
    } catch (error) {
        console.error('Error loading recipe from preview:', error);
        alert('Failed to load recipe: ' + error);
    }
}

async function editFromPreview() {
    if (!currentPreviewRecipeId) return;

    // Only allow editing user recipes
    if (!currentPreviewRecipeId.startsWith('user:')) {
        alert('Only user recipes can be edited. Built-in recipes are read-only.');
        return;
    }

    // Extract user recipe ID
    const userId = currentPreviewRecipeId.substring(5); // Remove 'user:' prefix

    // Close preview and open editor
    closeRecipePreview();
    await openRecipeEditor(userId);
}

async function refreshRecipeDropdown() {
    const recipeSelect = document.getElementById('recipe');
    const currentValue = recipeSelect.value;

    // Clear existing options
    recipeSelect.innerHTML = '';

    // Add "Custom settings..." option
    const customOption = document.createElement('option');
    customOption.value = '';
    customOption.textContent = 'Custom settings...';
    recipeSelect.appendChild(customOption);

    // Add divider (disabled optgroup)
    const divider1 = document.createElement('option');
    divider1.disabled = true;
    divider1.textContent = '────────────';
    recipeSelect.appendChild(divider1);

    // Add "Recipe Editor" option
    const editorOption = document.createElement('option');
    editorOption.value = '__editor__';
    editorOption.textContent = '✎ Recipe Editor';
    recipeSelect.appendChild(editorOption);

    // Add "Import Recipe" option
    const importOption = document.createElement('option');
    importOption.value = '__import__';
    importOption.textContent = '📥 Import Recipe...';
    recipeSelect.appendChild(importOption);

    // Add "Preview Recipes" option
    const previewOption = document.createElement('option');
    previewOption.value = '__preview__';
    previewOption.textContent = '👁 Preview Recipes...';
    recipeSelect.appendChild(previewOption);

    // Add divider
    const divider2 = document.createElement('option');
    divider2.disabled = true;
    divider2.textContent = '────────────';
    recipeSelect.appendChild(divider2);

    // Add built-in recipes
    const builtInRecipes = [
        { value: 'stars', label: 'Star Trails' },
        { value: 'murmurations', label: 'Bird Murmurations' },
        { value: 'traffic', label: 'Traffic Light Trails' },
        { value: 'timelapse', label: 'Time-Lapse' },
        { value: 'fireworks', label: 'Fireworks' },
        { value: 'noise-reduction', label: 'Noise Reduction' }
    ];

    builtInRecipes.forEach(recipe => {
        const option = document.createElement('option');
        option.value = recipe.value;
        option.textContent = recipe.label;
        recipeSelect.appendChild(option);
    });

    // Load and add user recipes
    try {
        const userRecipes = await invoke('list_user_recipes');

        if (userRecipes.length > 0) {
            // Add divider before user recipes
            const divider3 = document.createElement('option');
            divider3.disabled = true;
            divider3.textContent = '────────────';
            recipeSelect.appendChild(divider3);

            // Add user recipes with (User) prefix
            userRecipes.forEach(recipe => {
                const option = document.createElement('option');
                option.value = `user:${recipe.id}`;
                option.textContent = `${recipe.name} (User)`;
                recipeSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading user recipes:', error);
    }

    // Restore previous selection if still valid
    if (currentValue) {
        const options = Array.from(recipeSelect.options);
        if (options.some(opt => opt.value === currentValue)) {
            recipeSelect.value = currentValue;
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
