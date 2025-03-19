import {app, BrowserWindow} from 'electron'
import {fileURLToPath} from 'url'
import path from 'path'


//Convert the file URL to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

let mainWindow;

function createWindow() {
    // Create the browser windows
    mainWindow = new BrowserWindow({
        width:800,
        height:600,
        webPreferences: {
           // preload: path.join(__dirname, 'preload.js'), //load the preload script
            nodeIntegration: false, //Disable nodeInntegration for security
            contextIsolation: true, //Enable context isolation for security
        }
    });

    //ignore certificate errors (Development environment only)
    mainWindow.webContents.session.setCertificateVerifyProc((request, callback)=> {
        callback(0); //Bypass cert validation
    })

    //Load index.html file
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Open the DevTool (optional)
    mainWindow.webContents.openDevTools();

    // Emitted when the window is closed
    mainWindow.on('close', ()=> {
        mainWindow = null
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
