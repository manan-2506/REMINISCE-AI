/* -------------------------------------------------------------
   REMINISCE AI - Result Page Controller (IndexedDB Reader)
   ------------------------------------------------------------- */

const DB_NAME = 'ReminisceDB';
const STORE_NAME = 'images';

document.addEventListener("DOMContentLoaded", async () => {
    const loadingState = document.getElementById("loading-state");
    const comparisonContainer = document.getElementById("comparison-container");
    const previewInput = document.getElementById("preview-input");
    const previewOutput = document.getElementById("preview-output");
    const btnDownload = document.getElementById("btn-download");

    let objectUrls = [];

    // Open IndexedDB
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

    // Retrieve Images from DB
    async function getImages() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const reqOriginal = store.get('original');
            const reqColorized = store.get('colorized');
            const reqFilename = store.get('filename');
            
            transaction.oncomplete = () => {
                resolve({
                    original: reqOriginal.result,
                    colorized: reqColorized.result,
                    filename: reqFilename.result || 'reminisce_photo.png'
                });
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    try {
        const images = await getImages();
        
        if (!images.original || !images.colorized) {
            throw new Error("No image data found. Please upload a picture on the landing page first.");
        }

        // Create Object URLs
        const originalUrl = URL.createObjectURL(images.original);
        const colorizedUrl = URL.createObjectURL(images.colorized);
        
        objectUrls.push(originalUrl, colorizedUrl);

        // Populate elements
        previewInput.src = originalUrl;
        previewOutput.src = colorizedUrl;

        // Set up download button
        btnDownload.href = colorizedUrl;
        btnDownload.download = `colorized_${images.filename}`;

        // Transition UI
        loadingState.style.display = "none";
        comparisonContainer.style.display = "block";

    } catch (err) {
        console.error("IndexedDB retrieval error:", err);
        alert(`❌ Error displaying images:\n${err.message}`);
        window.location.href = "/";
    }

    // Handle clean-up when leaving page
    window.handleRestart = async () => {
        try {
            // Clean object URLs from browser memory
            objectUrls.forEach(url => URL.revokeObjectURL(url));
            
            // Clear IndexedDB records
            const db = await openDB();
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).clear();
            
            transaction.oncomplete = () => {
                window.location.href = "/";
            };
        } catch (error) {
            console.error("Failed to clean database:", error);
            window.location.href = "/";
        }
    };
});
