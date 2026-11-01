from functools import wraps

from django.http import JsonResponse

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

# Members of the working group who only read and listen to the shared
# transcriptions (/ecouter/): logged in, but no write access anywhere.
# Users are put in this group by hand in the admin.
READERS_GROUP = "Lecteurs"


def is_editor(user):
    """Logged in and not a reader."""
    return user.is_authenticated and not user.groups.filter(name=READERS_GROUP).exists()


def editor_required(view):
    """Reads stay public; any write (POST...) needs a logged-in editor.
    Answers a JSON 403 rather than a login redirect, since every write
    endpoint is called from page JS (fetch) that already displays `error`
    as-is."""
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.method not in SAFE_METHODS and not is_editor(request.user):
            message = ("Votre compte permet de lire et d'écouter, pas d'enregistrer."
                       if request.user.is_authenticated
                       else "Connexion requise pour enregistrer (menu « Connexion »).")
            return JsonResponse({"error": message}, status=403)
        return view(request, *args, **kwargs)
    return wrapper


def context_processor(request):
    """`can_edit` in every template (e.g. to show the "Saisie" menu entry)."""
    return {"can_edit": is_editor(request.user)}
