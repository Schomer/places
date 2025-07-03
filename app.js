document.addEventListener('DOMContentLoaded', async function() {
    
    // --- App Constants & Elements ---
    const DB_NAME = 'photo-map-db';
    const PHOTO_STORE_NAME = 'photos';
    const SETTINGS_STORE_NAME = 'settings';
    const BACKEND_URL = 'http://localhost:3000';
    let db;
    let markerMap = new Map();

    const map = L.map('map').setView([39.82, -98.57], 4);
    const markerGroup = L.featureGroup().addTo(map);
    const dropZone = document.getElementById('main-content');
    const photoListContainer = document.getElementById('photo-list-container');
    const loadingOverlay = document.getElementById('loading-overlay');
    const titleElement = document.getElementById('trip-title');
    const dateRangeElement = document.getElementById('date-range');

    // --- Initialization ---
    async function initDb() {
        db = await idb.openDB(DB_NAME, 2, {
            upgrade(db, oldVersion) {
                if (oldVersion < 1) { db.createObjectStore(PHOTO_STORE_NAME, { keyPath: 'id', autoIncrement: true }); }
                if (oldVersion < 2) { db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' }); }
            },
        });
        const titleSetting = await db.get(SETTINGS_STORE_NAME, 'title');
        if (!titleSetting) {
            await db.put(SETTINGS_STORE_NAME, { key: 'title', value: 'Trip' });
        }
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const ShowAllControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control show-all-control');
            container.innerText = 'Show All';
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(container, 'click', function () {
                if (markerGroup.getLayers().length > 0) {
                    map.fitBounds(markerGroup.getBounds(), { padding: [50, 50], animate: true });
                } else { alert('No photos with locations to show!'); }
            });
            return container;
        }
    });
    new ShowAllControl().addTo(map);

    // --- Core Functions ---
    async function loadTitle() {
        const savedSetting = await db.get(SETTINGS_STORE_NAME, 'title');
        titleElement.textContent = savedSetting?.value || 'Trip';
    }

    async function saveTitle() {
        await db.put(SETTINGS_STORE_NAME, { key: 'title', value: titleElement.textContent.trim() });
    }

    function formatDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const options = { month: 'long', day: 'numeric', year: 'numeric' };
        if (start.toDateString() === end.toDateString()) { return start.toLocaleDateString(undefined, options); }
        const startYear = start.getFullYear();
        const endYear = end.getFullYear();
        if (startYear === endYear) {
            if (start.getMonth() === end.getMonth()) {
                return `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${endYear}`;
            } else { return `${start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${end.toLocaleDateString(undefined, options)}`; }
        } else { return `${start.toLocaleDateString(undefined, options)} – ${end.toLocaleDateString(undefined, options)}`; }
    }

    async function refreshUI() {
        photoListContainer.innerHTML = '';
        markerGroup.clearLayers();
        markerMap.clear();
        const allPhotos = await db.getAll(PHOTO_STORE_NAME);
        allPhotos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const savedTitle = (await db.get(SETTINGS_STORE_NAME, 'title')).value;
        if (savedTitle === 'Trip' && allPhotos.length > 0) {
            const photosWithGps = allPhotos.filter(p => p.hasGps);
            if (photosWithGps.length > 0) {
                const regions = photosWithGps.map(p => p.locationName.split(', ').pop());
                const uniqueRegions = [...new Set(regions)];
                let newTitle = '';
                if (uniqueRegions.length === 1) { newTitle = `${uniqueRegions[0]} Trip`; }
                else if (uniqueRegions.length === 2) { newTitle = `${uniqueRegions.join(' & ')} Trip`; }
                else if (uniqueRegions.length > 2) { newTitle = uniqueRegions.join(', '); }
                if (newTitle) {
                    titleElement.textContent = newTitle;
                    await saveTitle();
                }
            }
        }

        if (allPhotos.length > 0) {
            const minDate = allPhotos[0].timestamp;
            const maxDate = allPhotos[allPhotos.length - 1].timestamp;
            dateRangeElement.textContent = formatDateRange(minDate, maxDate);
            dateRangeElement.classList.remove('hidden');
        } else {
            dateRangeElement.classList.add('hidden');
        }
        
        const groupedByDate = allPhotos.reduce((groups, photo) => {
            const date = new Date(photo.timestamp).toLocaleDateString('en-CA');
            if (!groups[date]) { groups[date] = []; }
            groups[date].push(photo);
            return groups;
        }, {});

        // --- THE DEFINITIVE, CORRECTED RENDER LOGIC ---
        for (const date of Object.keys(groupedByDate).sort().reverse()) {
            const dateHeader = document.createElement('li');
            dateHeader.className = 'date-header';
            dateHeader.textContent = new Date(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            photoListContainer.appendChild(dateHeader);
            
            for (const photo of groupedByDate[date]) {
                const { lat, lon, url, id, hasGps, timestamp, locationName } = photo;
                
                if (hasGps) {
                    const formattedDate = new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
                    const popupHtml = `<div class="popup-content"><img src="${url}" alt="Photo thumbnail"><p class="popup-date">${formattedDate}</p><p class="popup-location">${locationName}</p></div>`;
                    const marker = L.marker([lat, lon]).bindPopup(popupHtml);
                    markerMap.set(id, marker);
                    markerGroup.addLayer(marker);
                }

                const thumbnailItem = document.createElement('li');
                thumbnailItem.className = 'thumbnail-item';
                thumbnailItem.dataset.id = id;
                if (hasGps) {
                    thumbnailItem.dataset.lat = lat;
                    thumbnailItem.dataset.lon = lon;
                } else {
                    thumbnailItem.classList.add('no-gps');
                }
                const thumbnailImage = document.createElement('img');
                thumbnailImage.src = url;
                thumbnailItem.appendChild(thumbnailImage);
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.innerHTML = '×';
                thumbnailItem.appendChild(deleteBtn);
                
                // Append the thumbnail directly to the main container
                photoListContainer.appendChild(thumbnailItem);
            }
        }
        
        if (markerGroup.getLayers().length > 0) {
            const bounds = markerGroup.getBounds();
            if (bounds.isValid()) { map.fitBounds(bounds, { padding: [50, 50] }); }
        }
    }
    
    async function deletePhoto(id) {
        if (confirm('Are you sure you want to delete this photo? This cannot be undone.')) {
            await db.delete(PHOTO_STORE_NAME, id);
            await refreshUI();
        }
    }

    async function handleFiles(files) {
        loadingOverlay.style.display = 'flex';
        const uploadPromises = Array.from(files).map(file => {
            const formData = new FormData();
            formData.append('photo', file);
            return fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData, })
            .then(response => {
                if (!response.ok) { return response.json().then(err => Promise.reject(err)); }
                return response.json();
            })
            .catch(error => {
                console.error(`Error uploading ${file.name}:`, error);
                return { success: false, name: file.name };
            });
        });
        const results = await Promise.all(uploadPromises);
        const successfulUploads = results.filter(r => r.url);
        const failedUploads = results.filter(r => !r.url);
        if (successfulUploads.length > 0) {
            for (const photoData of successfulUploads) {
                await db.add(PHOTO_STORE_NAME, photoData);
            }
        }
        loadingOverlay.style.display = 'none';
        if (failedUploads.length > 0) {
            alert(`Failed to process ${failedUploads.length} photo(s): ${failedUploads.map(f => f.name).join(', ')}`);
        }
        await refreshUI();
    }

    // --- Event Listeners ---
    titleElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); titleElement.blur(); }
    });
    titleElement.addEventListener('blur', saveTitle);

    photoListContainer.addEventListener('click', function(e) {
        const deleteButton = e.target.closest('.delete-btn');
        const thumbnailItem = e.target.closest('.thumbnail-item');
        
        if (deleteButton) {
            e.stopPropagation();
            deletePhoto(parseInt(thumbnailItem.dataset.id, 10));
        } else if (thumbnailItem) {
            if (thumbnailItem.classList.contains('no-gps')) {
                alert('This photo has no location data to show on the map.');
                return;
            }
            const photoId = parseInt(thumbnailItem.dataset.id, 10);
            const marker = markerMap.get(photoId);
            if (marker) {
                map.flyTo(marker.getLatLng(), 15);
                map.once('moveend', function() {
                    marker.openPopup();
                });
            }
        }
    });

    function handleDrop(e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    }
    function handleDragEnter(e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add('drag-over');
    }
    function handleDragOver(e) {
        e.preventDefault(); e.stopPropagation();
    }
    function handleDragLeave(e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('drag-over');
    }
    dropZone.addEventListener('drop', handleDrop);
    dropZone.addEventListener('dragenter', handleDragEnter);
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    
    // --- Application Start ---
    await initDb();
    await loadTitle();
    await refreshUI();
});