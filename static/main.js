/* -------------------------------------------------------------
   REMINISCE AI - Interactive Uploader Controller
   ------------------------------------------------------------- */

const DB_NAME = 'ReminisceDB';
const STORE_NAME = 'images';

document.addEventListener("DOMContentLoaded", () => {
    // DOM Element Selectors
    const dropZone = document.getElementById("drop-zone");
    const browseBtn = document.getElementById("browse-btn");
    const fileInput = document.getElementById("file-input");
    const fileInfo = document.getElementById("file-info");
    const selectedFileName = document.getElementById("selected-file-name");
    const btnClear = document.getElementById("btn-clear");
    const btnColorize = document.getElementById("btn-colorize");
    const loadingState = document.getElementById("loading-state");
    const uploadCard = document.getElementById("upload-card");
    const nostalgiaSection = document.getElementById("nostalgia-section");

    let activeFile = null;

    // --- 1. IndexedDB Helper Functions ---

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function storeImages(originalBlob, colorizedBlob, filename) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.put(originalBlob, 'original');
            store.put(colorizedBlob, 'colorized');
            store.put(filename, 'filename');
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    // --- 2. File Upload Interaction Handlers ---

    browseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    dropZone.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });

    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("dragover");
        }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");
        }, false);
    });

    dropZone.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleSelectedFile(files[0]);
        }
    });

    // --- 3. Core File Handling & State Logic ---

    function handleSelectedFile(file) {
        if (!file.type.startsWith("image/")) {
            alert("❌ Error: Selected file is not an image. Please upload a valid picture.");
            return;
        }

        activeFile = file;
        selectedFileName.textContent = file.name;
        
        fileInfo.style.display = "flex";
        btnColorize.disabled = false;
        btnColorize.classList.add("btn-ready");
    }

    btnClear.addEventListener("click", (e) => {
        e.stopPropagation();
        clearFileUploader();
    });

    function clearFileUploader() {
        activeFile = null;
        fileInput.value = "";
        fileInfo.style.display = "none";
        btnColorize.disabled = true;
        btnColorize.classList.remove("btn-ready");
    }

    // --- 4. API Request & Redirection ---

    btnColorize.addEventListener("click", async () => {
        if (!activeFile) return;

        // Transition layout: Hide card & nostalgia, show full screen loading
        uploadCard.style.display = "none";
        if (nostalgiaSection) nostalgiaSection.style.display = "none";
        loadingState.style.display = "flex";
        btnColorize.disabled = true;

        const formData = new FormData();
        formData.append("image", activeFile);

        try {
            const response = await fetch("/colorize", {
                method: "POST",
                body: formData
            });

            if (!response.ok) {
                let errorMessage = `HTTP error! Status: ${response.status}`;
                try {
                    const text = await response.text();
                    try {
                        const errData = JSON.parse(text);
                        errorMessage = errData.error || errorMessage;
                    } catch (parseErr) {
                        if (text) errorMessage = text;
                    }
                } catch (readErr) {
                    errorMessage = `Failed to read error response: ${readErr.message}`;
                }
                throw new Error(errorMessage);
            }

            const colorizedBlob = await response.blob();

            // Save original image file and colored output blob in IndexedDB
            await storeImages(activeFile, colorizedBlob, activeFile.name);

            // Redirect to result page
            window.location.href = "/result";
            
        } catch (error) {
            console.error("Colorization API Error:", error);
            alert(`❌ Colorization Failed:\n${error.message}`);
            
            // Revert layout
            uploadCard.style.display = "flex";
            if (nostalgiaSection) nostalgiaSection.style.display = "block";
            loadingState.style.display = "none";
            btnColorize.disabled = false;
        }
    });
});
