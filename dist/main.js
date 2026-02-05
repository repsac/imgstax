const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

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

// Initialize
async function init() {
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
                inputValidationEl.textContent = `✓ Found ${result.image_count} images`;
                inputValidationEl.className = 'validation-message success';
                updateStartButtonState();

                // Load file list
                await loadFileList(selected);
            } else {
                inputValidationEl.textContent = `✗ ${result.error}`;
                inputValidationEl.className = 'validation-message error';
                startButton.disabled = true;
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
        quality: parseInt(document.getElementById('quality').value)
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
