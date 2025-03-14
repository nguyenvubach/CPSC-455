import {app, BrowserWindow} from 'electron'
import {fileURLTopPath} from 'url'
import path from 'path'


//Convert the file URL to a file path
const __filename = fileURLTopPath(import.meta.url);
const __dirname = path.dirname(__filename)

let mainWidow;

function createWindow() {
    // Create the browser windows
    mainWidow = new BrowserWindow({
        width:800,
        height:600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), //load the preload script
            nodeIntegration: false, //Disable nodeInntegration for security
            contextIsolation: true, //Enable context isolation for security
        }
    });

    //Load index.html file
    mainWidow.loadFile(path.join(__dirname, 'index.html'));

    // Open the DevTool (optional)
    //mainWondow.webContents.openDevTools();

    // Emitted when the window is closed
    mainWidow.on('close', ()=> {
        mainWidow = null
    })
}

    // Electron is ready to create the window
    app.whenReady().then(()=> {
        createWindow();

        //Handle macOS/Windows activate event
        app.on('activate', ()=> {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        })
    })

    app.on('window-all-closed', ()=> {
        if (process.platform !== 'darwin') {
            app.quit()
        }
    })
