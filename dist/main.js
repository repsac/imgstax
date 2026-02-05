const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, currentMonitor } = window.__TAURI__.window;

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
const fileListEl = document.getElementById('fileList');
const fileListTitleEl = document.getElementById('fileListTitle');
const previewContentEl = document.getElementById('previewContent');

// Window position persistence
function saveWindowPosition() {
    const window = getCurrentWindow();

    Promise.all([
        window.outerPosition(),
        window.outerSize(),
        currentMonitor()
    ]).then(([position, size, monitor]) => {
        const windowState = {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            monitorName: monitor?.name || null,
            timestamp: Date.now()
        };
        localStorage.setItem('windowState', JSON.stringify(windowState));
    }).catch(error => {
        console.error('Failed to save window position:', error);
    });
}

async function restoreWindowPosition() {
    try {
        const savedState = localStorage.getItem('windowState');
        if (!savedState) {
            return false; // No saved state, use default sizing
        }

        const state = JSON.parse(savedState);
        const window = getCurrentWindow();

        // Restore position and size
        await window.setSize({ width: state.width, height: state.height });
        await window.setPosition({ x: state.x, y: state.y });

        return true; // Successfully restored
    } catch (error) {
        console.error('Failed to restore window position:', error);
        return false;
    }
}

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
                await window.setSize({ width: targetWidth, height: targetHeight });
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

    try {
        const version = await invoke('get_app_version');
        statusEl.textContent = `imgstax v${version}`;
    } catch (error) {
        statusEl.textContent = `Error: ${error}`;
    }

    // Set up event listeners
    browseInputBtn.addEventListener('click', browseInputDirectory);
    browseOutputBtn.addEventListener('click', browseOutputDirectory);
    startButton.addEventListener('click', startStacking);
    openOutputButton.addEventListener('click', openOutputFolder);

    // Recipe event listener (main form)
    document.getElementById('recipe').addEventListener('change', loadMainFormRecipe);

    // Preferences event listeners
    document.getElementById('preferencesBtn').addEventListener('click', openPreferences);
    document.getElementById('prefRecipe').addEventListener('change', loadRecipeTemplate);
    document.getElementById('savePreferences').addEventListener('click', savePreferences);
    document.getElementById('cancelPreferences').addEventListener('click', closePreferences);
    document.getElementById('resetPreferences').addEventListener('click', resetPreferences);

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
            inputValidationEl.textContent = 'Validating...';
            inputValidationEl.className = 'validation-message';

            const result = await invoke('validate_directory', { path: selected });

            if (result.valid) {
                const formatText = result.detected_formats && result.detected_formats.length > 0
                    ? ` (${result.detected_formats.map(f => f.toUpperCase()).join(', ')})`
                    : '';
                inputValidationEl.textContent = `✓ Found ${result.image_count} images${formatText}`;
                inputValidationEl.className = 'validation-message success';
                updateStartButtonState();

                // Show/hide format-specific controls based on detected formats
                updateFormatControls(result.detected_formats || []);

                // Load file list
                await loadFileList(selected);
            } else {
                inputValidationEl.textContent = `✗ ${result.error}`;
                inputValidationEl.className = 'validation-message error';
                startButton.disabled = true;
                // Hide all format controls when validation fails
                updateFormatControls([]);
            }
        }
    } catch (error) {
        console.error('Error selecting directory:', error);
        inputValidationEl.textContent = `✗ ${error}`;
        inputValidationEl.className = 'validation-message error';
    }
}

async function loadFileList(dirPath) {
    try {
        fileListTitleEl.textContent = 'Loading files...';
        const files = await invoke('get_file_list', { path: dirPath });
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

        // Convert file path to file URL for Tauri v2
        const imageUrl = convertFileSrc(imagePath);
        console.log('Converted image URL:', imageUrl);

        previewContentEl.innerHTML = `<img src="${imageUrl}" class="preview-image" alt="Preview" onerror="console.error('Image failed to load:', '${imageUrl}'); this.parentElement.innerHTML='<div class=\\'preview-empty\\'>Failed to load image</div>'">`;
    } catch (error) {
        console.error('Error loading preview:', error);
        previewContentEl.innerHTML = '<div class="preview-empty">Error loading preview</div>';
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
}

async function startStacking() {
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
    startButton.disabled = true;

    try {
        const result = await invoke('start_stacking', { config });

        if (result.success) {
            outputDirFromStack = result.output_dir;
            progressText.textContent = 'Stacking complete!';
            openOutputButton.style.display = 'block';
        } else {
            progressText.textContent = `Error: ${result.error}`;
            setTimeout(() => {
                overlay.style.display = 'none';
                progressDialog.style.display = 'none';
                startButton.disabled = false;
            }, 3000);
        }
    } catch (error) {
        console.error('Stacking error:', error);
        progressText.textContent = `Error: ${error}`;
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
