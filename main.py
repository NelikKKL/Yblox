import customtkinter as ctk
from PIL import Image, ImageTk
import os
import sys
import json
import requests
from io import BytesIO
import threading
import webbrowser
import time

# UI Imports
import customtkinter as ctk
from PIL import Image, ImageTk

import webview

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

class YbloxApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Yandex Games Client")
        self.geometry("1100x700")
        
        # Set app icon
        icon_path = resource_path("icon.ico")
        if os.path.exists(icon_path):
            self.iconbitmap(icon_path)

        # Set appearance mode (default is dark)
        ctk.set_appearance_mode("dark")
        
        # Roblox-like theme colors
        self.colors = {
            "dark": {
                "bg": "#1B1D1F",
                "sidebar": "#232527",
                "topbar": "#232527",
                "card": "#232527",
                "text": "#FFFFFF",
                "accent": "#00A2FF"
            },
            "light": {
                "bg": "#F2F4F5",
                "sidebar": "#FFFFFF",
                "topbar": "#FFFFFF",
                "card": "#FFFFFF",
                "text": "#000000",
                "accent": "#00A2FF"
            }
        }

        # Layout configuration
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # --- Sidebar ---
        self.sidebar_frame = ctk.CTkFrame(self, width=200, corner_radius=0, fg_color=("#FFFFFF", "#232527"))
        self.sidebar_frame.grid(row=0, column=0, rowspan=2, sticky="nsew")
        self.sidebar_frame.grid_rowconfigure(5, weight=1)

        self.logo_label = ctk.CTkLabel(self.sidebar_frame, text="YBLOX", font=ctk.CTkFont(size=24, weight="bold"), text_color=("#000000", "#FFFFFF"))
        self.logo_label.grid(row=0, column=0, padx=20, pady=(20, 30))

        self.home_button = ctk.CTkButton(self.sidebar_frame, text="Home", fg_color="transparent", text_color=("#000000", "#FFFFFF"), hover_color=("#E5E5E5", "#393B3D"), anchor="w", command=self.load_games_async)
        self.home_button.grid(row=1, column=0, padx=10, pady=5, sticky="ew")

        self.discover_button = ctk.CTkButton(self.sidebar_frame, text="Discover", fg_color="transparent", text_color=("#000000", "#FFFFFF"), hover_color=("#E5E5E5", "#393B3D"), anchor="w", command=self.load_games_async)
        self.discover_button.grid(row=2, column=0, padx=10, pady=5, sticky="ew")

        self.settings_button = ctk.CTkButton(self.sidebar_frame, text="Settings", fg_color="transparent", text_color=("#000000", "#FFFFFF"), hover_color=("#E5E5E5", "#393B3D"), anchor="w", command=self.show_settings)
        self.settings_button.grid(row=3, column=0, padx=10, pady=5, sticky="ew")

        self.about_button = ctk.CTkButton(self.sidebar_frame, text="About", fg_color="transparent", text_color=("#000000", "#FFFFFF"), hover_color=("#E5E5E5", "#393B3D"), anchor="w", command=self.show_about)
        self.about_button.grid(row=4, column=0, padx=10, pady=5, sticky="ew")

        # --- Appearance Settings ---
        self.appearance_mode_label = ctk.CTkLabel(self.sidebar_frame, text="Theme:", anchor="w")
        self.appearance_mode_label.grid(row=6, column=0, padx=20, pady=(10, 0))
        self.appearance_mode_optionemenu = ctk.CTkOptionMenu(self.sidebar_frame, values=["Light", "Dark"],
                                                                       command=self.change_appearance_mode_event,
                                                                       fg_color=("#E5E5E5", "#393B3D"),
                                                                       button_color=("#E5E5E5", "#393B3D"),
                                                                       text_color=("#000000", "#FFFFFF"))
        self.appearance_mode_optionemenu.grid(row=7, column=0, padx=20, pady=(10, 20))
        self.appearance_mode_optionemenu.set("Dark")

        # --- Recent Games Storage ---
        self.recent_games_path = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), "Yblox_recent.json")
        self.settings_path = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), "Yblox_settings.json")
        
        self.settings = self.load_settings()
        self.recent_games = self.load_recent_games()

        # --- Top Bar ---
        self.top_bar = ctk.CTkFrame(self, height=60, corner_radius=0, fg_color=("#FFFFFF", "#232527"))
        self.top_bar.grid(row=0, column=1, sticky="ew")
        self.top_bar.grid_columnconfigure(0, weight=1)

        self.search_entry = ctk.CTkEntry(self.top_bar, placeholder_text="Search games...", width=400, fg_color=("#F2F4F5", "#1B1D1F"), border_width=0)
        self.search_entry.grid(row=0, column=0, padx=20, pady=15, sticky="w")
        self.search_entry.bind("<Return>", lambda e: self.load_games_async())

        self.user_label = ctk.CTkLabel(self.top_bar, text="User_1234", font=ctk.CTkFont(size=14), text_color=("#000000", "#FFFFFF"))
        self.user_label.grid(row=0, column=1, padx=20, pady=15)

        # --- Main Content (Game Grid) ---
        self.main_content = ctk.CTkScrollableFrame(self, corner_radius=0, fg_color=("#F2F4F5", "#1B1D1F"))
        self.main_content.grid(row=1, column=1, sticky="nsew")
        self.main_content.grid_columnconfigure((0, 1, 2, 3), weight=1)

        self.load_games_async()

    def load_settings(self):
        default_settings = {
            "adblock_enabled": True,
            "theme": "Dark"
        }
        try:
            if os.path.exists(self.settings_path):
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    # Update defaults with saved settings to handle new keys
                    default_settings.update(settings)
                    return default_settings
        except Exception as e:
            print(f"Error loading settings: {e}")
        return default_settings

    def save_settings(self):
        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"Error saving settings: {e}")

    def show_settings(self):
        # Clear main content
        for widget in self.main_content.winfo_children():
            widget.destroy()
            
        settings_frame = ctk.CTkFrame(self.main_content, fg_color="transparent")
        settings_frame.pack(fill="both", expand=True, padx=40, pady=40)
        
        title_label = ctk.CTkLabel(settings_frame, text="Settings", font=ctk.CTkFont(size=24, weight="bold"))
        title_label.pack(pady=(0, 30), anchor="w")
        
        # Adblock setting
        adblock_frame = ctk.CTkFrame(settings_frame, fg_color="transparent")
        adblock_frame.pack(fill="x", pady=10)
        
        adblock_label = ctk.CTkLabel(adblock_frame, text="Adblocker", font=ctk.CTkFont(size=16))
        adblock_label.pack(side="left")
        
        adblock_switch = ctk.CTkSwitch(adblock_frame, text="", 
                                      command=lambda: self.toggle_adblock(adblock_switch.get()),
                                      progress_color="#00A2FF")
        adblock_switch.pack(side="right")
        if self.settings.get("adblock_enabled", True):
            adblock_switch.select()
        else:
            adblock_switch.deselect()
            
        # Info text for adblock
        adblock_info = ctk.CTkLabel(settings_frame, text="Enables/disables the built-in adblocker for games.", 
                                   font=ctk.CTkFont(size=12), text_color="gray")
        adblock_info.pack(pady=(0, 20), anchor="w")

    def toggle_adblock(self, value):
        self.settings["adblock_enabled"] = bool(value)
        self.save_settings()
        print(f"Adblock set to: {self.settings['adblock_enabled']}")

    def show_about(self):
        # Clear main content
        for widget in self.main_content.winfo_children():
            widget.destroy()
            
        about_frame = ctk.CTkFrame(self.main_content, fg_color="transparent")
        about_frame.pack(fill="both", expand=True, padx=40, pady=40)
        
        title_label = ctk.CTkLabel(about_frame, text="About Yandex Games Client", font=ctk.CTkFont(size=24, weight="bold"))
        title_label.pack(pady=(0, 20), anchor="w")
        
        version_label = ctk.CTkLabel(about_frame, text="Version: 1.0.0", font=ctk.CTkFont(size=14))
        version_label.pack(pady=5, anchor="w")
        
        desc_text = "A Roblox-style desktop client for Yandex Games with built-in adblocking and recent games history."
        desc_label = ctk.CTkLabel(about_frame, text=desc_text, font=ctk.CTkFont(size=14), wraplength=600, justify="left")
        desc_label.pack(pady=20, anchor="w")
        
        # GitHub Link
        github_frame = ctk.CTkFrame(about_frame, fg_color="transparent")
        github_frame.pack(fill="x", pady=10)
        
        github_label = ctk.CTkLabel(github_frame, text="Source Code:", font=ctk.CTkFont(size=14, weight="bold"))
        github_label.pack(side="left", padx=(0, 10))
        
        github_link = ctk.CTkLabel(github_frame, text="github.com/NelikKKL/Yblox", text_color="#00A2FF", cursor="hand2")
        github_link.pack(side="left")
        github_link.bind("<Button-1>", lambda e: webbrowser.open("https://github.com/NelikKKL/Yblox"))
        
        # License
        license_label = ctk.CTkLabel(about_frame, text="License: MIT License", font=ctk.CTkFont(size=14))
        license_label.pack(pady=5, anchor="w")
        
        license_btn = ctk.CTkButton(about_frame, text="View License", width=120, height=32,
                                   fg_color="transparent", border_width=1, border_color="gray",
                                   command=lambda: webbrowser.open("https://opensource.org/licenses/MIT"))
        license_btn.pack(pady=20, anchor="w")

    def fetch_yandex_games(self, query=None):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                "Referer": "https://yandex.ru/games/",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1"
            }
            
            games = []
            
            # Если есть запрос — идем на страницу поиска, если нет — на главную
            url = f"https://yandex.ru/games/search?query={requests.utils.quote(query)}" if query else "https://yandex.ru/games/"
            
            print(f"Fetching games from: {url}")
            session = requests.Session()
            r = session.get(url, headers=headers, timeout=15)
            if r.status_code != 200:
                print(f"HTTP Error: {r.status_code}")
                return []

            # МЕТОД 1: Извлечение из различных JSON блоков (initialState, __INITIAL_STATE__, etc.)
            import re
            import json
            
            # Ищем все возможные блоки состояния
            state_patterns = [
                r'initialState\s*=\s*({.*?});',
                r'__INITIAL_STATE__\s*=\s*({.*?});',
                r'data-state="({.*?})"',
                r'<script type="application/json" id="initial-state">({.*?})</script>'
            ]
            
            for pattern in state_patterns:
                match = re.search(pattern, r.text, re.DOTALL)
                if match:
                    try:
                        raw_json = match.group(1)
                        # Если это атрибут data-state, он может быть экранирован
                        if pattern == r'data-state="({.*?})"':
                            import html
                            raw_json = html.unescape(raw_json)
                            
                        data = json.loads(raw_json)
                        print(f"Found state block with pattern: {pattern[:20]}...")
                        
                        # Ищем игры в разных ветках JSON
                        potential_paths = [
                            data.get("feed", {}).get("items", []),
                            data.get("catalog", {}).get("sections", []),
                            data.get("search", {}).get("items", []),
                            data.get("popular", {}).get("items", [])
                        ]
                        
                        for path in potential_paths:
                            if not isinstance(path, list): continue
                            for item in path:
                                if not isinstance(item, dict): continue
                                # Обработка разных структур
                                g_data = item.get("game") or (item if "app_id" in item or "id" in item else None)
                                if g_data and isinstance(g_data, dict):
                                    games.append(self._format_game_from_json(g_data))
                                elif item.get("items"):
                                    for sub_item in item.get("items", []):
                                        sg_data = sub_item.get("game") or sub_item
                                        if sg_data and isinstance(sg_data, dict):
                                            games.append(self._format_game_from_json(sg_data))
                    except Exception as e:
                        print(f"JSON block parse error: {e}")

            # МЕТОД 2 (РЕЗЕРВНЫЙ): Глубокий парсинг HTML
            if len(games) < 3:
                print("Using deep HTML scraping fallback...")
                games.extend(self._parse_html_games(r.text))

            # Удаляем дубликаты по App ID
            seen_ids = set()
            unique_games = []
            for g in games:
                app_id = g.get("app_id") or g.get("app_url")
                if app_id and app_id not in seen_ids and g.get("name") != "Unknown Game":
                    seen_ids.add(app_id)
                    unique_games.append(g)
            
            print(f"Final count: {len(unique_games)} unique games")
            return unique_games[:60]
        except Exception as e:
            print(f"Global fetch error: {e}")
        return []

    def _parse_html_games(self, html_content):
        from bs4 import BeautifulSoup
        import re
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Ищем все ссылки на приложения
        links = soup.find_all('a', href=re.compile(r'/games/app/(\d+)'))
        parsed = []
        
        for link in links:
            try:
                href = link.get('href')
                app_id_match = re.search(r'/app/(\d+)', href)
                if not app_id_match: continue
                app_id = app_id_match.group(1)
                
                # Идем вверх по дереву, чтобы найти контейнер карточки
                # и извлечь название и картинку
                name = "Game"
                img = ""
                
                curr = link
                for _ in range(5): # Ищем в пределах 5 уровней вверх
                    if not curr: break
                    
                    # Ищем заголовок
                    if name == "Game":
                        title_el = curr.find(re.compile(r'h\d')) or curr.select_one('[class*="title"]')
                        if title_el:
                            name = title_el.text.strip()
                    
                    # Ищем картинку
                    if not img:
                        img_el = curr.find('img')
                        if img_el:
                            img = img_el.get('src') or img_el.get('data-src') or img_el.get('srcset', '').split(' ')[0]
                    
                    if name != "Game" and img: break
                    curr = curr.parent
                
                if img.startswith("//"): img = "https:" + img
                
                parsed.append({
                    "name": name,
                    "app_id": app_id,
                    "plays": "10K+",
                    "rating": "4.8",
                    "thumb_url": img,
                    "app_url": f"https://yandex.ru/games/app/{app_id}"
                })
            except: continue
        return parsed

    def load_games_async(self):
        # Clear current games
        for widget in self.main_content.winfo_children():
            widget.destroy()
            
        loading_label = ctk.CTkLabel(self.main_content, text="Loading games from Yandex...", font=ctk.CTkFont(size=16))
        loading_label.grid(row=0, column=0, columnspan=4, pady=100)
        
        query = self.search_entry.get()
        threading.Thread(target=self._load_games_thread, args=(query,), daemon=True).start()

    def _load_games_thread(self, query):
        games = self.fetch_yandex_games(query)
        self.after(0, lambda: self.display_games(games))

    def load_recent_games(self):
        try:
            if os.path.exists(self.recent_games_path):
                with open(self.recent_games_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading recent games: {e}")
        return []

    def save_recent_game(self, game):
        # Remove if already exists to move to front
        self.recent_games = [g for g in self.recent_games if g['app_url'] != game['app_url']]
        # Add to front
        self.recent_games.insert(0, game)
        # Keep only last 8
        self.recent_games = self.recent_games[:8]
        
        try:
            with open(self.recent_games_path, "w", encoding="utf-8") as f:
                json.dump(self.recent_games, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"Error saving recent games: {e}")

    def clear_recent_games(self):
        self.recent_games = []
        try:
            if os.path.exists(self.recent_games_path):
                os.remove(self.recent_games_path)
            self.load_games_async()
        except Exception as e:
            print(f"Error clearing history: {e}")

    def display_games(self, games):
        # Clear loading label
        for widget in self.main_content.winfo_children():
            widget.destroy()

        if not games and not self.recent_games:
            no_games_frame = ctk.CTkFrame(self.main_content, fg_color="transparent")
            no_games_frame.grid(row=0, column=0, columnspan=4, pady=100)
            
            no_games_label = ctk.CTkLabel(no_games_frame, text="No games found or connection error.", font=ctk.CTkFont(size=16))
            no_games_label.pack(pady=10)
            
            retry_button = ctk.CTkButton(no_games_frame, text="Retry", command=self.load_games_async)
            retry_button.pack(pady=10)
            return

        current_row = 0

        # --- Recently Played Section ---
        if self.recent_games:
            header_frame = ctk.CTkFrame(self.main_content, fg_color="transparent")
            header_frame.grid(row=current_row, column=0, columnspan=4, padx=20, pady=(20, 10), sticky="ew")
            
            recent_label = ctk.CTkLabel(header_frame, text="Recently Played", font=ctk.CTkFont(size=20, weight="bold"))
            recent_label.pack(side="left")
            
            clear_btn = ctk.CTkButton(header_frame, text="Clear History", width=100, height=28, 
                                     fg_color="transparent", border_width=1, border_color="gray",
                                     text_color=("gray20", "gray80"), hover_color=("#E5E5E5", "#393B3D"),
                                     command=self.clear_recent_games)
            clear_btn.pack(side="right")
            
            current_row += 1
            
            recent_scroll = ctk.CTkScrollableFrame(self.main_content, height=350, orientation="horizontal", fg_color="transparent")
            recent_scroll.grid(row=current_row, column=0, columnspan=4, sticky="ew", padx=10)
            current_row += 1
            
            for i, game in enumerate(self.recent_games):
                card = self.create_game_card(recent_scroll, game)
                card.pack(side="left", padx=10, pady=5)

        # --- All Games Section ---
        if games:
            all_games_label = ctk.CTkLabel(self.main_content, text="Recommended for You", font=ctk.CTkFont(size=20, weight="bold"))
            all_games_label.grid(row=current_row, column=0, columnspan=4, padx=20, pady=(20, 10), sticky="w")
            current_row += 1
            
            grid_frame = ctk.CTkFrame(self.main_content, fg_color="transparent")
            grid_frame.grid(row=current_row, column=0, columnspan=4, sticky="nsew")
            grid_frame.grid_columnconfigure((0, 1, 2, 3), weight=1)
            
            for i, game in enumerate(games):
                row = i // 4
                col = i % 4
                card = self.create_game_card(grid_frame, game)
                card.grid(row=row, column=col, padx=10, pady=10, sticky="nsew")

    def create_game_card(self, parent, game):
        card = ctk.CTkFrame(parent, width=200, height=320, fg_color=("#FFFFFF", "#232527"), corner_radius=10)
        
        # Game thumbnail
        thumb_label = ctk.CTkLabel(card, text="⌛", font=ctk.CTkFont(size=50), width=180, height=140, fg_color=("#E5E5E5", "#393B3D"), corner_radius=8)
        thumb_label.pack(pady=10, padx=10)
        
        if game.get("thumb_url"):
            threading.Thread(target=self._load_thumb_thread, args=(game["thumb_url"], thumb_label), daemon=True).start()
        
        name_label = ctk.CTkLabel(card, text=game["name"], font=ctk.CTkFont(size=14, weight="bold"), text_color=("#000000", "#FFFFFF"), wraplength=160, height=40)
        name_label.pack(pady=2, padx=10, anchor="w")
        
        id_label = ctk.CTkLabel(card, text=f"ID: {game.get('app_id', '???')}", font=ctk.CTkFont(size=10), text_color="gray")
        id_label.pack(pady=0, padx=10, anchor="w")
        
        stats_label = ctk.CTkLabel(card, text=f"⭐ {game['rating']}  👤 {game['plays']}", font=ctk.CTkFont(size=11), text_color="gray")
        stats_label.pack(pady=2, padx=10, anchor="w")

        play_button = ctk.CTkButton(card, text="Play", height=35, fg_color="#00A2FF", hover_color="#0082CC", text_color="white", font=ctk.CTkFont(weight="bold"), command=lambda g=game: self.play_game(g))
        play_button.pack(pady=(10, 15), padx=10, fill="x")
        
        return card

    def play_game(self, game):
        url = game["app_url"]
        title = game["name"]
        print(f"Opening game: {title} at {url}")
        
        # Save to recent games
        self.save_recent_game(game)
        
        # Refresh UI
        self.load_games_async()

        # Launch PyQt5 Browser in a SEPARATE PROCESS for stability and to fix white screen
        import subprocess
        try:
            # Get the path to the current executable or script
            if getattr(sys, 'frozen', False):
                # If running as EXE
                executable = sys.executable
                adblock_flag = "--adblock-on" if self.settings.get("adblock_enabled", True) else "--adblock-off"
                args = [executable, "--browser", "--url", url, "--title", title, adblock_flag]
            else:
                # If running as script
                executable = sys.executable
                adblock_flag = "--adblock-on" if self.settings.get("adblock_enabled", True) else "--adblock-off"
                args = [executable, __file__, "--browser", "--url", url, "--title", title, adblock_flag]
            
            print(f"Launching browser process: {args}")
            subprocess.Popen(args)
        except Exception as e:
            print(f"Browser process error: {e}")
            webbrowser.open(url)

    def _load_thumb_thread(self, url, label):
        try:
            if not url or not url.startswith("http"):
                if url and url.startswith("//"):
                    url = "https:" + url
                else:
                    self.after(0, lambda: label.configure(text="🎮"))
                    return
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Referer": "https://yandex.ru/"
            }
            
            response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
            if response.status_code == 200:
                img_data = response.content
                img = Image.open(BytesIO(img_data))
                
                # Convert to RGBA if necessary
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                    
                img = img.resize((180, 140), Image.Resampling.LANCZOS)
                ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=(180, 140))
                self.after(0, lambda: label.configure(image=ctk_img, text=""))
            else:
                print(f"Thumb error {response.status_code} for {url}")
                self.after(0, lambda: label.configure(text="🎮"))
        except Exception as e:
            print(f"Error loading thumbnail {url}: {e}")
            self.after(0, lambda: label.configure(text="🎮"))

    def change_appearance_mode_event(self, new_appearance_mode: str):
        ctk.set_appearance_mode(new_appearance_mode)

    def dummy_command(self):
        print("Button clicked!")

if __name__ == "__main__":
    # Check if we are launching the browser or the main app
    if "--browser" in sys.argv:
        # Browser process using pywebview (Edge WebView2)
        url = ""
        title = "Game"
        adblock_enabled = True
        
        if "--url" in sys.argv:
            url = sys.argv[sys.argv.index("--url") + 1]
        if "--title" in sys.argv:
            title = sys.argv[sys.argv.index("--title") + 1]
        if "--adblock-off" in sys.argv:
            adblock_enabled = False

        # Load adblock scripts
        def get_adblock_script():
            try:
                rules_path = resource_path(os.path.join("adblock", "rules.json"))
                script_path = resource_path(os.path.join("adblock", "adblock_content.js"))
                
                rules_data = "{}"
                if os.path.exists(rules_path):
                    with open(rules_path, "r", encoding="utf-8") as f:
                        rules_data = f.read()
                
                content_script = ""
                if os.path.exists(script_path):
                    with open(script_path, "r", encoding="utf-8") as f:
                        content_script = f.read()
                
                polyfill = f"""
                (function() {{
                    if (window.__adblock_injected) return;
                    window.__adblock_injected = true;
                    
                    window.adblockRules = {rules_data};
                    
                    const chrome = {{
                        storage: {{
                            local: {{
                                get: (keys) => Promise.resolve({{ enabled: true, whitelist: [] }}),
                                set: (data) => Promise.resolve()
                            }}
                        }},
                        runtime: {{
                            getURL: (path) => path,
                            onMessage: {{ addListener: () => {{}}, sendMessage: () => Promise.resolve() }}
                        }}
                    }};
                    window.chrome = chrome;
                    window.browser = chrome;
                    
                    {content_script}
                    
                    if(typeof injectAntiAntiAdblock === 'function') injectAntiAntiAdblock();
                    console.log("Adblock polyfill and script executed");
                }})();
                """
                return polyfill
            except Exception as e:
                print(f"Adblock error: {e}")
                return ""

        adblock_js = get_adblock_script() if adblock_enabled else ""

        def on_loaded(window):
            if adblock_js:
                # Initial injection
                window.evaluate_js(adblock_js)
                
                # Try to set up persistent injection for all frames via WebView2 API
                try:
                    # pywebview uses edgechromium on Windows. 
                    # We can try to access the underlying CoreWebView2 to inject into all frames
                    # This works for Edge Chromium (WebView2)
                    if hasattr(window, 'gui') and hasattr(window.gui, 'browser'):
                        browser = window.gui.browser
                        if hasattr(browser, 'CoreWebView2'):
                            core = browser.CoreWebView2
                            # This ensures the script runs in every frame (including cross-domain iframes)
                            core.AddScriptToExecuteOnDocumentCreatedAsync(adblock_js)
                            print("Adblock enabled for all frames via WebView2 API")
                except Exception as e:
                    print(f"Frame injection error: {e}")
                    
                print("Adblock injected into main frame")

        window = webview.create_window(title, url, width=1280, height=720, background_color='#1B1D1F')
        webview.start(on_loaded, window, gui='edgechromium')
        sys.exit(0)
    else:
        # Main App process
        app = YbloxApp()
        app.mainloop()
