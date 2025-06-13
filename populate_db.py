# populate_db.py
import os
import django

# Set up the Django environment (if running as a script outside the Django project)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'hakkadbapp.settings')
django.setup()

from hakkadbapp.models import Initial, Final, Tone, Pronunciation, Word, VocabList

def populate_database():
    # Step 2: Create Initial, Final, and Tone objects
    initial_n = Initial.objects.create(initial='n')
    final_i = Final.objects.create(final='i')
    tone_3 = Tone.objects.create(tone_number=3)
    
    # Print confirmation
    print("Database populated successfully with sample data.")

def populate_hakka_phonetics():
    Initial.objects.all().delete()
    Final.objects.all().delete()
    Tone.objects.all().delete()

    # List of common Hakka initials (example set)
    hakka_initials = [
        'b', 'p', 'm', 'f',
        'd', 't', 'n', 'l',
        'g', 'k', 'ng', 'h',
        'z', 'c', 's',
        'j', 'q', 'x',
        'r',
        # Add more if needed
    ]

    # List of common Hakka finals (example set)
    hakka_finals = [
        # -a- nucleus rows
        'a', 'ai', 'au', 'am', 'an', 'ang', 'ap', 'at', 'ak',
        'ya', 'yai', 'yau', 'yam', 'yan', 'yang', 'yap', 'yat', 'yak',
        'wa', 'wai', 'wan', 'wang', 'wat', 'wak',

        # -e- nucleus rows
        'e', 'eu', 'em', 'en', 'ep', 'et',
        'yen', 'yet',
        'wen', 'wet',

        # -i- nucleus
        'i', 'wi', 'im', 'in', 'ip', 'it',

        # -o- nucleus
        'o', 'oi', 'on', 'ong', 'ot', 'ok',
        'yo', 'yoi', 'yon', 'yong', 'yok',
        'wo', 'won', 'wong', 'wok',

        # -u- nucleus
        'u', 'un', 'ung', 'ut', 'uk',
        'yui', 'yu', 'yun', 'yung', 'yut', 'yuk',

        # Syllabics
        'm', 'ng',
    ]
    # Create Initial objects
    for initial_str in hakka_initials:
        Initial.objects.get_or_create(initial=initial_str)

    # Create Final objects
    for final_str in hakka_finals:
        Final.objects.get_or_create(final=final_str)

    # Create 6 tones (1 to 6)
    for tone_num in range(1, 7):
        Tone.objects.get_or_create(tone_number=tone_num)

    print("Hakka initials, finals, and tones populated successfully.")

if __name__ == '__main__':
    # populate_database()
    populate_hakka_phonetics()
