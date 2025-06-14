from dotenv import load_dotenv
load_dotenv()  # Loads .env from project root

from hakkadbapp.wsgi import application as app  # 👈 Vercel expects `app`
