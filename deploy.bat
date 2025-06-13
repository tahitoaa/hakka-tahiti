pip freeze > .\requirements.txt
git add .\requirements.txt
git commit -m "update requirements"
git push
python.exe manage.py collectstatic --no-input
vercel --prod