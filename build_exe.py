import PyInstaller.__main__
import os
import shutil

def build():
    # Name of the output executable
    name = "Yblox"
    
    # Path to the main script
    script = "main.py"
    
    # Cleanup before build to avoid "EndUpdateResourceW" errors
    print("Cleaning up old build files...")
    for folder in ["build", "dist"]:
        if os.path.exists(folder):
            try:
                shutil.rmtree(folder)
                print(f"Deleted {folder}")
            except Exception as e:
                print(f"Warning: Could not delete {folder}: {e}")
    
    # PyInstaller arguments
    args = [
        script,
        f"--name={name}",
        "--onefile",
        "--noconsole",
        f"--icon=icon.ico",
        "--add-data=icon.ico;.",
        "--add-data=adblock;adblock",
        # Hidden imports for pywebview (Edge WebView2)
        "--hidden-import=webview.platforms.winforms",
        "--hidden-import=clr",
    ]
    
    print(f"Building {name}.exe...")
    PyInstaller.__main__.run(args)
    print("Build complete! Check the 'dist' folder.")

if __name__ == "__main__":
    build()
