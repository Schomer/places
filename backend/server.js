const express = require('express');
const multer = require('multer');
const { exiftool } = require("exiftool-vendored");
const heif = require('heic-convert'); // Re-enabled this line
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdir(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use('/uploads', express.static(UPLOADS_DIR));
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

const upload = multer({ dest: os.tmpdir() });

app.post('/upload', upload.single('photo'), async (req, res) => {
    let tempFilePath = req.file.path; // Store temp path for cleanup

    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const originalName = req.file.originalname;
        let photoData = { lat: null, lon: null, timestamp: new Date(), hasGps: false, locationName: 'Location not found' };

        const tags = await exiftool.read(tempFilePath);
        
        // You can remove the console.log now that we've diagnosed the issue
        // console.log('--- METADATA FOUND BY EXIFTOOL ---', tags);

        if (tags.GPSLatitude && tags.GPSLongitude) {
            photoData.hasGps = true;
            photoData.lat = tags.GPSLatitude;
            photoData.lon = tags.GPSLongitude;
            if (tags.DateTimeOriginal) {
                const dtValue = tags.DateTimeOriginal;
                photoData.timestamp = dtValue.toUTC ? new Date(dtValue.toUTC()) : new Date(dtValue);
            }
            try {
                const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${photoData.lat}&lon=${photoData.lon}&zoom=14`;
                const myHeaders = new Headers({ "User-Agent": "PhotoMapApp/1.0" });
                const response = await fetch(geoUrl, { method: 'GET', headers: myHeaders });
                if (response.ok) {
                    const geoData = await response.json();
                    if (geoData && geoData.address) {
                        const addr = geoData.address;
                        const nameParts = [addr.city || addr.town || addr.village || addr.hamlet, addr.county, addr.state, addr.country !== 'United States' ? addr.country : null].filter(Boolean);
                        if (nameParts.length > 0) photoData.locationName = nameParts.join(', ');
                    }
                }
            } catch (geoError) { console.error('Reverse geocoding fetch failed:', geoError); }
        }

        // --- Corrected File Handling and HEIC Conversion ---
        let outputBuffer;
        let outputFilename = `${path.parse(originalName).name}.jpeg`; // Always aim for JPEG output

        if (req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif') {
            const inputBuffer = await fs.readFile(tempFilePath);
            outputBuffer = await heif({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
        } else {
            // For non-HEIC files, just read the file into the buffer
            outputBuffer = await fs.readFile(tempFilePath);
            // And use its original extension if it's not HEIC
            outputFilename = originalName;
        }

        const finalFilename = `${Date.now()}-${path.basename(outputFilename).replace(/[^a-zA-Z0-9-._]/g, '')}`;
        const outputPath = path.join(UPLOADS_DIR, finalFilename);

        // Write the final (possibly converted) buffer to the uploads directory
        await fs.writeFile(outputPath, outputBuffer);

        res.json({ ...photoData, url: `http://localhost:${PORT}/uploads/${finalFilename}` });

    } catch (error) {
        console.error('Server error during upload:', error);
        res.status(500).send('An unexpected error occurred on the server.');
    } finally {
        // --- Cleanup ---
        // Always delete the temporary file from the temp directory
        if (tempFilePath) {
            await fs.unlink(tempFilePath).catch(err => console.error('Failed to delete temp file:', err));
        }
    }
});

const server = app.listen(PORT, () => {
    console.log(`✅ Your application is running!`);
    console.log(`   - Frontend is at http://localhost:${PORT}`);
    console.log(`   - Backend is listening for uploads on the same port.`);
});

process.on('exit', () => exiftool.end());
process.on('SIGINT', () => {
    console.log('\nGracefully shutting down from SIGINT (Ctrl+C)...');
    server.close(() => {
        console.log('Server is closed. Exiting now.');
        process.exit(0);
    });
});