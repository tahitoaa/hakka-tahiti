import uuid
import json
import zipfile

def encode_custom(o):
    if hasattr(o, "to_dict"):
        return o.to_dict()
    # raise TypeError(f"{o.__class__.__name__} is not JSON serializable")

class Streamable:
    def __init__(self):
        pass
    def to_dict(self):
        return {k: v for k, v in self.__dict__.items() if k != "id"}
    
class Translations(Streamable):
    def __init__(self, primary, secondary, target):
        super().__init__()
        self.primary = primary
        self.secondary = secondary
        self.target = target

class Identified(Streamable):
    instances = {}
    @classmethod
    def export(cls):
        return json.dumps(cls.instances, default=encode_custom, ensure_ascii=False)

    def __init__(self):
        self.id = str(uuid.uuid4())
        self.__class__.instances[self.id] = self

class Theme(Identified):
    def __new__(cls, primary, secondary, target):
        # Reuse existing instance
        for id, theme in cls.instances.items():
            if theme.translations.primary == primary:
                theme._reuse = True 
                return theme
        # Create new instance
        obj = super().__new__(cls)
        obj._reuse = False
        return obj

    def __init__(self, primary, secondary, target):
        
        if getattr(self, "_reuse", False):
            return
        
        super().__init__()
        self.translations = Translations(primary, secondary, target)

class Word(Identified): 
    instances = {}
    def __init__(self, target, primary, secondary):
        super().__init__()
        self.translations = Translations(primary, secondary, target)
        self.themes = [] # themes id
        self.audio = "" # audio id 
        self.image = "" # image id
        self.level = 0
        self.in_expression = [] # Expression id
        self.part_of_speech = "n"
        self.gloss_code = []
        self.variants = {}

    # "00b78a7f-46a7-4a7e-9005-7b76fcf74a00": {
    #     "audio": "327f011f-b09d-4690-afd9-c8fd743da1ba",
    #     "gloss_code": [],
    #     "image": "b3d94cf4-48f2-4c13-83e0-323b90f9a9d3",
    #     "in_expression": [],
    #     "level": 0,
    #     "part_of_speech": "n",
    #     "themes": [
    #         "3f6de0a5-09e2-4615-b6ab-ef6062cbb44d"
    #     ],
    #     "translations": {
    #         "primary": "végétarien",
    #         "secondary": "vegetarian",
    #         "target": "shit⁶zai¹ 食斋"
    #     },
    #     "variants": {}
    # },


class Expression(Identified):
    instances = {}
#     "266e3714-1198-4e5e-88a3-3675e221b3cd": {
    #     "components": {},
    #     "level": 0,
    #     "themes": [],
    #     "translations": {
    #         "primary": "Je vais",
    #         "secondary": "I go",
    #         "target": "ngai¹我 hi⁴去"
    #     }
    # },
    def __init__(self, target, primary, secondary):
        super().__init__()
        self.translations = Translations(primary, secondary, target)
        self.themes = [] # thmes id
        self.level = 0 
        self.components = {}
    

# meteo = Theme("météo", "weather", "天时")
# salutations = Theme("salutations", "greetings", "招呼")

# # x,,ngai¹ 我,je,I,Pronoms personnels,,ngai1.
# je = Word("ngai¹ 我", "je", "I")
# # x,,ngi¹ 你,tu,you,Pronoms personnels,,ngi1.png
# # x,,gi¹ 佢,il/elle,he/she,Pronoms personnels,,gi1.png
# # x,,mai³pien⁴yi² 买便宜,promotion,promotion,Commerce,,mai3pien4yi2.png
# # x,,gam³ga⁴ 减价,"réduction, remise","discount, rebate",Commerce,,gam3ga4.png
# # x,,fui²zon³qian² 回转钱,rembourser,repay,Commerce,,fui2zon3qian2.png
# # x,,giam³zon³qian² 捡转钱,rendre la monnaie,give change,Commerce,,giam3zon3qian2.png
# # x,,sen¹li¹ 生理,un business,a business,Commerce,,sen1li1.png
# # x,,son⁴pan² 算盘,boulier,abacus,Commerce,,son4pan2.png
# # x,,zong¹ 装,transporter,carry,Commerce,,zong1.png
# # x,,oi⁴ 爱,aimer,to like,Verbes usuels,,oi4.png
# # x,,zung¹yi⁴ 中意,aimer,to like,Verbes usuels,,zung1yi4.png
# # x,,hi⁴ 去,aller,go,Verbes usuels,,hi4.png
# # x,,ten³ 等,attendre,to wait for,Verbes usuels,,ten3.png
# # x,,zuk⁵ 捉,attraper,catch,Verbes usuels,,zuk5.png
# # x,,mak⁶zoi³ 擗嘴,bâiller,yawn,Verbes usuels,,mak6zoi3.png
# # x,,yim³ 饮,boire,drink,Verbes usuels,,yim3.png
# # x,,son⁴ 算,compter,count,Verbes usuels,,son4.png
# # x,,ha¹ 下,descendre,to come down,Verbes usuels,,ha1.png
# # x,,shoi⁴ 睡,dormir,sleep,Verbes usuels,,shoi4.png
# # x,,tang¹yim¹ngok⁶ 听音乐,écouter de la musique,listen to music,Verbes usuels,,tang1yim1ngok6.png
# # x,,xia³ 写,écrire,to write,Verbes usuels,,xia3.png
# # x,,zut⁶ 拭,essuyer,to wipe,Verbes usuels,,zut6.
# je = Word("ngai¹ 我", "je", "I")
# je.themes.append(salutations.id)
# tu = Word("ngi¹ 你", "tu", "you")
# tu.themes.append(salutations.id)
# Word("gi¹ 佢", "il/elle", "he/she")
# Word("mai³pien⁴yi² 买便宜", "promotion", "promotion")
# Word("gam³ga⁴ 减价", "réduction, remise", "discount, rebate")
# Word("fui²zon³qian² 回转钱", "rembourser", "repay")
# Word("giam³zon³qian² 捡转钱", "rendre la monnaie", "give change")
# Word("sen¹li¹ 生理", "un business", "a business")
# Word("son⁴pan² 算盘", "boulier", "abacus")
# Word("zong¹ 装", "transporter", "carry")
# Word("oi⁴ 爱", "aimer", "to like")
# Word("zung¹yi⁴ 中意", "aimer", "to like")
# Word("hi⁴ 去", "aller", "go")
# attendre = Word("ten³ 等", "attendre", "to wait for")
# attendre.themes.append(salutations.id)
# Word("zuk⁵ 捉", "attraper", "catch")
# Word("mak⁶zoi³ 擗嘴", "bâiller", "yawn")
# Word("yim³ 饮", "boire", "drink")

# e1 = Expression("我等你", "Je t'attends", "I am waiting for you")
# e1.themes.append(salutations.id)
# for word in [je, attendre, tu]:
#     e1.components[word.translations.target] = word.id
# # Write Theme corpus to JSON
# with open("themeCorpus.json", "w", encoding="utf-8") as f:
#     f.write(Theme.export())

# # Write Word corpus to JSON
# with open("wordCorpus.json", "w", encoding="utf-8") as f:
#     f.write(Word.export())

# # Write Expression corpus to JSON
# with open("expressionCorpus.json", "w", encoding="utf-8") as f:
#     f.write(Expression.export())

# # List of files to compress
# files_to_zip = ["themeCorpus.json", "wordCorpus.json", "expressionCorpus.json"]

# # Name of the output ZIP
# zip_name = "corpus.zip"

# with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
#     for file in files_to_zip:
#         zipf.write(file)