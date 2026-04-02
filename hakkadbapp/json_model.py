import json
import uuid
from copy import deepcopy


def encode_custom(o):
    if hasattr(o, "to_dict"):
        return o.to_dict()


class Streamable:
    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if k != "id" and k != "_reuse"}


class Translations(Streamable):
    def __init__(self, primary="", secondary="", target=""):
        self.primary = primary
        self.secondary = secondary
        self.target = target


class Identified(Streamable):
    instances = {}

    @classmethod
    def reset(cls):
        cls.instances = {}

    @classmethod
    def export(cls, indent=2):
        return json.dumps(cls.instances, default=encode_custom, ensure_ascii=False, indent=indent, sort_keys=True)

    @classmethod
    def load_corpus(cls, path):
        """Load a JSON corpus file into the class instances map."""
        cls.reset()
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for obj_id, payload in data.items():
            cls.from_dict(obj_id, payload)
        return cls.instances

    @classmethod
    def get_id(cls, obj_id):
        return cls.instances.get(obj_id)

    @classmethod
    def get_by_target(cls, target):
        for instance in cls.instances.values():
            if getattr(getattr(instance, "translations", None), "target", None) == target:
                return instance
        return None

    @classmethod
    def find_first(cls, **criteria):
        """
        Find first instance matching given attributes.
        Supports nested attributes via dot notation.
        """
        for instance in cls.instances.values():
            match = True
            for attr, value in criteria.items():
                obj = instance
                for part in attr.split("."):
                    obj = getattr(obj, part, None)
                if obj != value:
                    match = False
                    break
            if match:
                return instance.id
        return None

    def __init__(self, id=None):
        self.id = id or str(uuid.uuid4())
        self.__class__.instances[self.id] = self


class Theme(Identified):
    instances = {}

    def __init__(self, id=None, primary=None, secondary=None, target=None):
        super().__init__(id=id)
        self.translations = Translations(primary, secondary, target)

    @classmethod
    def from_dict(cls, obj_id, data):
        tr = data.get("translations", {})
        return cls(
            id=obj_id,
            primary=tr.get("primary", ""),
            secondary=tr.get("secondary", ""),
            target=tr.get("target", ""),
        )

    @classmethod
    def get(cls, primary):
        if primary is None:
            return None
        needle = str(primary).strip().lower()
        for theme in cls.instances.values():
            current = (theme.translations.primary or "").strip().lower()
            if current == needle:
                return theme
        return None

    @classmethod
    def get_or_create(cls, primary, secondary=None, target=None):
        theme = cls.get(primary)
        if theme:
            return theme
        return cls(primary=primary, secondary=secondary, target=target)


class Word(Identified):
    instances = {}

    def __init__(
        self,
        target,
        primary,
        secondary,
        id=None,
        *,
        themes=None,
        audio="",
        image="",
        level=0,
        in_expression=None,
        part_of_speech="n",
        gloss_code=None,
        variants=None,
    ):
        super().__init__(id=id)
        self.translations = Translations(primary, secondary, target)
        self.themes = list(themes or [])
        self.audio = audio
        self.image = image
        self.level = level
        self.in_expression = list(in_expression or [])
        self.part_of_speech = part_of_speech
        self.gloss_code = list(gloss_code or [])
        self.variants = deepcopy(variants or {})

    @classmethod
    def from_dict(cls, obj_id, data):
        tr = data.get("translations", {})
        return cls(
            target=tr.get("target", ""),
            primary=tr.get("primary", ""),
            secondary=tr.get("secondary", ""),
            id=obj_id,
            themes=data.get("themes", []),
            audio=data.get("audio", ""),
            image=data.get("image", ""),
            level=data.get("level", 0),
            in_expression=data.get("in_expression", []),
            part_of_speech=data.get("part_of_speech", "n"),
            gloss_code=data.get("gloss_code", []),
            variants=data.get("variants", {}),
        )


class Expression(Identified):
    instances = {}

    def __init__(
        self,
        target,
        primary,
        secondary,
        id=None,
        *,
        themes=None,
        level=0,
        components=None,
    ):
        super().__init__(id=id)
        self.translations = Translations(primary, secondary, target)
        self.themes = list(themes or [])
        self.level = level
        self.components = deepcopy(components or {})

    @classmethod
    def from_dict(cls, obj_id, data):
        tr = data.get("translations", {})
        return cls(
            target=tr.get("target", ""),
            primary=tr.get("primary", ""),
            secondary=tr.get("secondary", ""),
            id=obj_id,
            themes=data.get("themes", []),
            level=data.get("level", 0),
            components=data.get("components", {}),
        )
