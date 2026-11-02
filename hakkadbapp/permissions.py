from functools import wraps

from django.http import JsonResponse

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

# Members of the working group who only read and listen to the shared
# transcriptions (/ecouter/): logged in, but no write access anywhere.
# Users are put in this group by hand in the admin.
READERS_GROUP = "Lecteurs"

# The AI assistant's account (assistant.py): it suggests new words and
# writes comments, through assistant.py's own functions only. It is not an
# editor: every editor endpoint refuses it, so it can't change, validate
# or delete anything, whatever it asks for.
ASSISTANTS_GROUP = "Assistants IA"
AI_USERNAME = "ia"


# Who decides: only the members of this group may validate or reject an
# addition, or take one out of « Validé » / « Rejeté » (additions.py, the
# admin). Membership is managed in the admin (Utilisateurs -> Groupes);
# superusers are not members by default.
VALIDATORS_GROUP = "Validateurs"
DECIDED_STATUSES = ("validated", "rejected")


def is_validator(user):
    return bool(user and user.is_authenticated and user.is_active
                and user.groups.filter(name=VALIDATORS_GROUP).exists())


def status_change_refused(user, old, new):
    """Error message when `user` may not move an addition from `old` to
    `new` status, else None."""
    if old == new or is_validator(user):
        return None
    if new in DECIDED_STATUSES or old in DECIDED_STATUSES:
        return "Seuls les validateurs (groupe « Validateurs ») peuvent valider, rejeter ou revenir sur une décision."
    return None


def is_assistant(user):
    return user.is_authenticated and user.groups.filter(name=ASSISTANTS_GROUP).exists()


def is_editor(user):
    """Logged in, and neither a reader nor the AI assistant."""
    return (user.is_authenticated
            and not user.groups.filter(name__in=[READERS_GROUP, ASSISTANTS_GROUP]).exists())


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
    """`can_edit` and `can_validate` in every template (e.g. to show the
    "Saisie" menu entry, the « Valider » buttons)."""
    return {"can_edit": is_editor(request.user), "can_validate": is_validator(request.user)}
