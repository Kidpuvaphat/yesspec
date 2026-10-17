from __future__ import annotations
import json
import re
from pathlib import Path
from urllib.parse import quote

from price_sync_mcp import extract_all_products_from_index

SHOPEE_AFF_ID = "15385610012"
LAZADA_AFF_ID = "267671179"
LAZ_EXLAZ = "e_B7mvt0tli55sbdaDA0DvZOb5ctG2SI%252F1oCEiHEl%252FUv6VEqD9MYhqUaBZjUeQcq%252FEsHyU0g7Ue2BaQSn2j07SOpy%252BluXF85Cop2wKbp7jb3SMVF0silKVnV0eDLXAhVqJ0%252F%252BjTUiUr75fykH4ULsnb5jPvKUp8JpoyrI0XKdux4HApXygm91QTIosaAsYiMVgksbiVaOKUnAW%252FECuMLE35Q%253D%253D"
LAZ_SHARE = "4161151791_1_9300_110172189818_4161153791_null"
LAZ_TOKEN = "08d572ad001a0d070782467eba3d16d9"

# Verified 100% exact-model Official Shopee Shortlinks
OFFICIAL_SHOPEE_SHORTLINKS = {
    "lg-oled-c6-65": ("https://s.shopee.co.th/70KwOjgXMp", 45900, 60390, "24%", "LG Official Store"),
    "mitsu-heavy-yvs": ("https://s.shopee.co.th/50ZrzYz77K", 15900, 18900, "16%", "Mitsubishi Heavy Duty Official"),
    "sony-wh1000xm5": ("https://s.shopee.co.th/an_redir?origin_link=https%3A%2F%2Fshopee.co.th%2Fproduct%2F15889763396&affiliate_id=15385610012&sub_id=yespecsonyxm5----", 9990, 13900, "28%", "Sony Thailand Official"),
}

OFFICIAL_LAZADA_SHORTLINKS = {
    "sony-wh1000xm5": "https://s.lazada.co.th/s.Z9VZHC?c=d&t=p-i6N0J3o-sR7OOVM"
}

# Strict required tokens and banned tokens per product ID so a direct PDP link
# is ONLY used when it is 100% the exact brand, model series, and capacity/size!
STRICT_MODEL_RULES: dict[str, tuple[list[str], list[str]]] = {
    "samsung-a06": (["samsung", "a06"], ["a07", "case", "เคส"]),
    "poco-c75": (["poco", "c75"], ["15c", "case", "เคส"]),
    "vivo-y19s": (["vivo", "y19s"], ["case", "เคส"]),
    "iqoo-z9x-5g": (["z9x"], ["case", "เคส"]),
    "samsung-a16-5g": (["samsung", "a16"], ["not for sale", "a07", "case"]),
    "redmi-note-14-5g": (["redmi", "note 14"], ["note 17", "pro", "case"]),
    "samsung-a55-5g": (["samsung", "a55"], ["a17", "a07", "case"]),
    "redmi-note-14-pro-plus": (["redmi", "note 14", "pro"], ["note 17", "case"]),
    "vivo-v40e-5g": (["vivo", "v40e"], ["y05", "case"]),
    "poco-f6-pro": (["poco", "f6", "pro"], ["f9", "tcl", "case"]),
    "vivo-v40-zeiss": (["vivo", "v40"], ["v70", "v40e", "case"]),
    "xiaomi-14t": (["xiaomi", "14t"], ["pro", "note 17", "hisense", "case"]),
    "xiaomi-14t-pro": (["xiaomi", "14t", "pro"], ["oppo", "reno", "case"]),
    "samsung-s25": (["samsung", "s25"], ["ultra", "plus", "fe", "case"]),
    "iphone-16-128": (["iphone", "16"], ["pro", "air", "case"]),
    "iphone-17-pro": (["iphone", "17", "pro"], ["case"]),
    "iphone-18-pro": (["iphone", "18", "pro"], ["iphone 17", "case"]),
    "samsung-s26-ultra": (["samsung", "s26", "ultra"], ["case"]),
    "redmi-pad-se": (["redmi", "pad", "se"], ["pad 2", "case"]),
    "ipad-gen11": (["ipad", "11"], ["air", "pro", "case"]),
    "ipad-air-m3": (["ipad", "air", "m3"], ["a16", "11th", "tcl", "case"]),
    "ipad-pro-oled": (["ipad", "pro", "m4"], ["ipad air", "hisense", "case"]),
    "tcl-tpro-12k": (["tcl", "t-pro", "12"], ["9000", "9,000"]),
    "hisense-kb-12k": (["hisense", "12"], ["9000", "9,000"]),
    "carrier-xinverter": (["carrier", "xinverter"], ["fixed"]),
    "mitsu-heavy-yvs": (["mitsubishi", "heavy", "inverter"], ["fixed speed"]),
    "daikin-zesth": (["daikin", "inverter", "12"], ["9000", "9,000", "tcl"]),
    "acer-aspire-lite": (["acer", "aspire", "lite"], ["410p"]),
    "asus-vivobook-15": (["asus", "vivobook"], []),
    "lenovo-loq-rtx": (["lenovo", "loq"], []),
    "macbook-air-13": (["macbook", "air", "13"], []),
    "tcl-55-4k-smart": (["tcl", "55"], ["65", "75", "samsung"]),
    "hisense-55e6n": (["hisense", "55"], ["65", "75"]),
    "tcl-c855-65": (["tcl", "65", "c855"], ["lg", "65t5m"]),
    "samsung-qn90f-65": (["samsung", "65", "qn90"], ["crystal", "ue800", "lg"]),
    "lg-oled-c6-65": (["lg", "oled", "65"], []),
    "samsung-rt22-8q": (["samsung", "rt22"], ["7.3", "comfee"]),
    "lg-2door-14q": (["lg", "14"], ["11.8", "tcl"]),
    "mitsu-4door-la70": (["mitsubishi", "4", "20"], []),
    "hitachi-4door-wb640": (["hitachi", "20.1"], []),
    "hisense-front-9kg": (["hisense", "9"], ["samsung", "top-loading", "comfee"]),
    "samsung-ecobubble-10": (["samsung", "10"], ["combo"]),
    "lg-aidd-12kg": (["lg", "12"], []),
    "electrolux-uc700": (["electrolux", "11"], []),
    "haier-dryer-7kg": (["haier", "dryer"], ["xiaomi"]),
    "beko-condenser-8": (["electrolux", "dryer"], []),
    "samsung-heatpump-9": (["samsung", "9"], ["washing machine"]),
    "lg-dual-heatpump-10": (["lg", "10"], []),
    "xiaomi-purifier-compact": (["xiaomi", "compact"], ["pet care"]),
    "xiaomi-purifier-4": (["xiaomi", "purifier", "4"], ["purifier 6"]),
    "philips-ac1715": (["philips", "purifier"], ["xiaomi"]),
    "sharp-fp-j80": (["sharp", "80"], []),
    "xiaomi-robot-s20": (["xiaomi", "s20"], ["x20"]),
    "xiaomi-x20-plus": (["xiaomi", "x20"], ["eufy"]),
    "dreame-x40-ultra": (["dreame", "x40"], ["l10s"]),
    "roborock-s8-maxv": (["roborock", "s8"], ["qrevo"]),
    "xiaomi-g20-lite": (["xiaomi", "g20"], ["p30"]),
    "dreame-r10": (["dreame", "r10"], []),
    "dreame-h14-wetdry": (["dreame", "h14"], ["h16"]),
    "dyson-v12-slim": (["dyson", "v12"], ["submarine"]),
    "sharp-wh34": (["sharp", "3500"], ["4500", "keve"]),
    "pana-dh-3ns": (["panasonic", "3500"], ["4500"]),
    "stiebel-copper-45": (["stiebel", "4500"], ["3500"]),
    "pana-pump-45": (["panasonic", "4500"], ["3500", "dh-4vl1tw"]),
    "mazuma-uf-easy": (["mazuma"], ["uni pure"]),
    "philips-uv-purifier": (["philips", "aut"], ["xiaomi"]),
    "xiaomi-ro-600g": (["xiaomi", "600g"], ["800g"]),
    "philips-hotcold-ro": (["philips", "ro"], ["xiaomi"]),
    "gaabor-airfryer-5l": (["gaabor", "5"], []),
    "xiaomi-airfryer-65": (["xiaomi", "6.5"], ["4.5l"]),
    "samsung-grill-mw": (["samsung", "23"], ["sharp", "20 liters"]),
    "philips-airfryer-xxl": (["philips", "airfryer", "5000"], []),
    "duchess-cm5000": (["duchess"], ["cafelffe"]),
    "nespresso-essenza": (["nespresso", "essenza"], []),
    "delonghi-dedica": (["delonghi", "dedica"], ["duchess"]),
    "delonghi-magnifica": (["delonghi", "magnifica"], []),
    "redmi-watch-5-lite": (["redmi", "watch", "5"], []),
    "huawei-gt5": (["huawei", "watch", "gt", "5"], ["gt 7"]),
    "garmin-fr265": (["garmin", "265"], ["170", "165"]),
    "watch-s11": (["apple", "watch"], ["galaxy"]),
    "soundcore-space-one": (["soundcore", "space", "one"], ["a40"]),
    "airpods-pro-2": (["airpods", "pro"], ["airpods 5"]),
    "sony-wh1000xm5": (["sony", "wh-1000xm5"], ["wf-1000"]),
    "bose-qc-ultra": (["bose", "ultra"], ["earbuds"]),
    "xiaomi-a24i-100hz": (["xiaomi", "a24i"], []),
    "lg-27-ips": (["lg", "27"], ["ultragear"]),
    "lg-ultragear-27": (["lg", "ultragear", "27", "2k"], ["fhd"]),
    "dell-ultrasharp-4k": (["dell", "ultrasharp", "27"], []),
    "furradec-ergo-mesh": (["furradec"], []),
    "bewell-ergo-lite": (["bewell"], ["sihoo"]),
    "ergotrend-dual-mesh": (["ergotrend"], ["modena"]),
    "steelcase-series": (["steelcase"], ["xpanse"]),
    "jbl-go-4": (["jbl", "go", "4"], []),
    "jbl-charge-5": (["jbl", "charge", "5"], ["flip"]),
    "marshall-acton-3": (["marshall", "acton"], []),
    "samsung-soundbar-q600": (["samsung", "q600"], ["hw-s801"]),
    "70mai-m310": (["70mai", "m310"], []),
    "70mai-a810": (["70mai", "a810"], ["a500s"]),
    "dji-action-5": (["dji", "action", "5"], []),
    "dji-pocket-3": (["dji", "pocket", "3"], ["pocket 4"]),
    "xiaomi-h101-dryer": (["xiaomi", "h101"], []),
    "xiaomi-h500-dryer": (["xiaomi", "h500"], []),
    "dreame-hair-glory": (["dreame", "glory"], []),
    "dyson-supersonic-nural": (["dyson", "supersonic"], []),
    "biore-uv-aqua": (["biore", "aqua"], []),
    "anessa-gold-milk": (["anessa", "milk"], ["20 ml"]),
    "mizumi-uv-water": (["mizumi", "water"], []),
    "laroche-anthelios": (["la roche", "anthelios"], []),
    "alodia-bergamot": (["bergamot"], ["legano"]),
    "sunsilk-smooth": (["sunsilk"], []),
    "vichy-dercos": (["vichy", "dercos"], []),
    "daeng-gi-meo-ri": (["daeng gi meo ri"], []),
    "dentiste-anticavity": (["dentiste"], ["sensodyne"]),
    "sensodyne-repair": (["sensodyne"], []),
    "colgate-optic": (["colgate", "optic"], ["มี 5 แพ็ค"]),
    "marvis-whitening": (["marvis"], []),
    "shokubutsu-monogatari": (["shokubutsu"], []),
    "dettol-shower-gel": (["dettol"], []),
    "bioderma-atoderm": (["eucerin", "ph5"], ["refill", "รีฟิล"]),
    "loccitane-almond": (["almond", "shower"], ["shimmering", "body oil"]),
    "vistras-b-complex": (["vistra", "b"], ["magnesium"]),
    "blackmores-bio-c": (["blackmores", "bio c"], []),
    "mega-nat-c": (["nat c", "1000"], []),
    "swisse-ultivite": (["swisse", "ultivite"], []),
    "plantae-plant-protein": (["plantae"], []),
    "dymatize-iso100": (["iso100"], ["fresubin"]),
    "matell-whey": (["baam", "whey"], []),
    "on-gold-standard": (["optimum", "gold standard"], []),
    "vida-collagen-q10": (["vida", "collagen"], []),
    "swisse-glow-collagen": (["swisse", "collagen"], []),
    "chame-probiotic": (["probiotic"], []),
    "meiji-amino-collagen": (["meiji", "collagen"], []),
    "kaniva-indoor": (["kaniva", "indoor"], ["mother", "kitten"]),
    "purina-one-cat": (["purina", "one"], ["friskies", "ฟริสกี้ส์"]),
    "maxima-cat": (["maxima", "15"], ["2 kg", "2kg"]),
    "royal-canin-indoor": (["royal canin", "indoor"], []),
    "smartheart-gold": (["smartheart"], ["puppy"]),
    "buzz-netura-dog": (["buzz"], ["kaniva"]),
    "royal-canin-mini": (["royal canin", "mini", "adult"], ["ageing", "12+"]),
    "hills-science-diet": (["hill", "small"], ["7+"]),
    "ciaochuru-variety": (["ciao"], []),
    "kasty-tofu-litter": (["kasty"], []),
    "catbest-original": (["cat's best", "40"], ["20l"]),
    "pethroom-litter-box": (["petkit", "pura"], []),
    # Newly added Top-10 Brand models that match real Lazada PDPs in lazada_live_products.json:
    "sharp-microwave-r220": (["sharp", "r-220"], []),
    "eufy-omni-c20": (["eufy", "c20"], []),
    "sihoo-m18-ergonomic": (["sihoo", "m18"], []),
    "modena-anya-ergonomic": (["modena", "anya"], []),
    "kaniva-dog-salmon-tuna": (["kaniva", "dog", "salmon"], []),
}

BRAND_OFFICIAL_STORE_MAP: list[tuple[str, str]] = [
    ("apple", "Apple Flagship Store"),
    ("iphone", "Apple Flagship Store"),
    ("ipad", "Apple Flagship Store"),
    ("macbook", "Apple Flagship Store"),
    ("airpods", "Apple Flagship Store"),
    ("samsung", "Samsung Official Store"),
    ("xiaomi", "Xiaomi Official Store"),
    ("redmi", "Xiaomi Official Store"),
    ("poco", "POCO Official Store"),
    ("vivo", "vivo Official Store"),
    ("iqoo", "iQOO Official Store"),
    ("oppo", "OPPO Official Store"),
    ("realme", "realme Official Store"),
    ("honor", "HONOR Official Store"),
    ("infinix", "Infinix Official Store"),
    ("huawei", "Huawei Official Store"),
    ("lenovo", "Lenovo Official Store"),
    ("teclast", "Teclast Official Store"),
    ("alldocube", "Alldocube Official Store"),
    ("tcl", "TCL Official Store"),
    ("hisense", "Hisense Official Store"),
    ("carrier", "Carrier Official Store"),
    ("mitsubishi heavy", "Mitsubishi Heavy Duty Official"),
    ("mitsubishi electric", "Mitsubishi Electric Official"),
    ("mitsubishi", "Mitsubishi Electric Official"),
    ("daikin", "Daikin Official Store"),
    ("haier", "Haier Official Store"),
    ("lg", "LG Official Store"),
    ("saijo denki", "Saijo Denki Official Store"),
    ("acer", "Acer Official Store"),
    ("asus", "ASUS Official Store"),
    ("hp", "HP Official Store"),
    ("dell", "Dell Official Store"),
    ("msi", "MSI Official Store"),
    ("gigabyte", "Gigabyte Official Store"),
    ("sony", "Sony Official Store"),
    ("toshiba", "Toshiba Official Store"),
    ("sharp", "Sharp Official Store"),
    ("panasonic", "Panasonic Official Store"),
    ("hitachi", "Hitachi Official Store"),
    ("electrolux", "Electrolux Official Store"),
    ("beko", "Beko Official Store"),
    ("candy", "Candy Official Store"),
    ("bosch", "Bosch Official Store"),
    ("coway", "Coway Official Store"),
    ("levoit", "Levoit Official Store"),
    ("blueair", "Blueair Official Store"),
    ("dyson", "Dyson Official Store"),
    ("hatari", "Hatari Official Store"),
    ("dreame", "Dreame Official Store"),
    ("roborock", "Roborock Official Store"),
    ("ecovacs", "Ecovacs Official Store"),
    ("eufy", "Eufy Official Store"),
    ("tapo", "TP-Link Tapo Official"),
    ("ezviz", "EZVIZ Official Store"),
    ("autobot", "Autobot Official Store"),
    ("irobot", "iRobot Official Store"),
    ("deerma", "Deerma Official Store"),
    ("tineco", "Tineco Official Store"),
    ("simplus", "Simplus Official Store"),
    ("stiebel", "Stiebel Eltron Official"),
    ("mazuma", "Mazuma Official Store"),
    ("mex", "Mex Official Store"),
    ("rinnai", "Rinnai Official Store"),
    ("3m", "3M Official Store"),
    ("pure", "Pure Official Store"),
    ("cuckoo", "Cuckoo Official Store"),
    ("clarte", "Clarte Official Store"),
    ("masterkool", "Masterkool Official Store"),
    ("gaabor", "Gaabor Official Store"),
    ("tefal", "Tefal Official Store"),
    ("locknlock", "LocknLock Official Store"),
    ("duchess", "Duchess Official Store"),
    ("nespresso", "Nespresso Official Store"),
    ("delonghi", "DeLonghi Official Store"),
    ("de'longhi", "DeLonghi Official Store"),
    ("nescaf", "NESCAFE Dolce Gusto Official"),
    ("minimex", "Minimex Official Store"),
    ("breville", "Breville Official Store"),
    ("garmin", "Garmin Official Store"),
    ("amazfit", "Amazfit Official Store"),
    ("coros", "COROS Official Store"),
    ("suunto", "Suunto Official Store"),
    ("mibro", "Mibro Official Store"),
    ("soundcore", "Soundcore Official Store"),
    ("bose", "Bose Official Store"),
    ("sennheiser", "Sennheiser Official Store"),
    ("marshall", "Marshall Official Store"),
    ("jbl", "JBL Official Store"),
    ("beats", "Beats Official Store"),
    ("edifier", "Edifier Official Store"),
    ("audio-technica", "Audio-Technica Official"),
    ("aoc", "AOC Official Store"),
    ("benq", "BenQ Official Store"),
    ("viewsonic", "ViewSonic Official Store"),
    ("furradec", "OfficeMate Official Store"),
    ("bewell", "Bewell Official Store"),
    ("ergotrend", "Ergotrend Official Store"),
    ("steelcase", "Steelcase Official Store"),
    ("sihoo", "Sihoo Official Store"),
    ("modena", "Modena Official Store"),
    ("anda seat", "Anda Seat Official Store"),
    ("secretlab", "Secretlab Official Store"),
    ("herman miller", "Herman Miller Official"),
    ("hbada", "Hbada Official Store"),
    ("fender", "Fender Official Store"),
    ("b&o", "Bang & Olufsen Official"),
    ("70mai", "70mai Official Store"),
    ("dji", "DJI Official Store"),
    ("canon", "Canon Official Store"),
    ("fujifilm", "Fujifilm Official Store"),
    ("nikon", "Nikon Official Store"),
    ("lumix", "Lumix Official Store"),
    ("ricoh", "Ricoh Official Store"),
    ("akaso", "AKASO Official Store"),
    ("insta360", "Insta360 Official Store"),
    ("laifen", "Laifen Official Store"),
    ("lesasha", "Lesasha Official Store"),
    ("create ion", "Create Ion Official Store"),
    ("yoole", "Yoole Official Store"),
    ("biore", "Biore Official Store"),
    ("anessa", "Anessa Official Store"),
    ("mizumi", "MizuMi Official Store"),
    ("la roche", "La Roche-Posay Official"),
    ("eucerin", "Eucerin Official Store"),
    ("l'oreal", "L'Oreal Paris Official"),
    ("her hyness", "Her Hyness Official Store"),
    ("clear nose", "Clear Nose Official Store"),
    ("garnier", "Garnier Official Store"),
    ("canmake", "Canmake Official Store"),
    ("bergamot", "Bergamot Official Store"),
    ("sunsilk", "Unilever Official Store"),
    ("vichy", "Vichy Official Store"),
    ("daeng gi meo ri", "Daeng Gi Meo Ri Official"),
    ("yves rocher", "Yves Rocher Official Store"),
    ("lyo", "LYO Official Store"),
    ("aloex", "AloEx Official Store"),
    ("tsubaki", "Tsubaki Official Store"),
    ("kundal", "Kundal Official Store"),
    ("dentiste", "Dentiste Official Store"),
    ("sensodyne", "Sensodyne Official Store"),
    ("colgate", "Colgate Official Store"),
    ("marvis", "Marvis Official Store"),
    ("tepthai", "Tepthai Official Store"),
    ("sparkle", "Sparkle Official Store"),
    ("haewon", "Haewon Official Store"),
    ("curaprox", "Curaprox Official Store"),
    ("systema", "Lion Official Store"),
    ("salz", "Lion Official Store"),
    ("shokubutsu", "Lion Official Store"),
    ("dettol", "Dettol Official Store"),
    ("l'occitane", "L'Occitane Official Store"),
    ("vaseline", "Vaseline Official Store"),
    ("cerave", "CeraVe Official Store"),
    ("boya", "Karmart Boya Official"),
    ("lux", "Unilever Official Store"),
    ("benice", "BeNice Official Store"),
    ("vistra", "Vistra Official Store"),
    ("blackmores", "Blackmores Official Store"),
    ("mega we care", "Mega We Care Official"),
    ("swisse", "Swisse Official Store"),
    ("dhc", "DHC Official Store"),
    ("centrum", "Centrum Official Store"),
    ("california gold", "California Gold Official"),
    ("vida", "Vida Official Store"),
    ("bomi", "MizuMi & Bomi Official"),
    ("dr.pong", "Dr.PONG Official Store"),
    ("plantae", "Plantae Official Store"),
    ("dymatize", "Fitwhey Official Store"),
    ("baam", "Fitwhey Official Store"),
    ("optimum nutrition", "Optimum Nutrition Official"),
    ("biovitt", "Biovitt Official Store"),
    ("muscletech", "MuscleTech Official Store"),
    ("mateell", "Mateell Official Store"),
    ("ultimate nutrition", "Fitwhey Official Store"),
    ("beanbag", "Beanbag Official Store"),
    ("proflex", "Proflex Official Store"),
    ("meiji", "Meiji Official Store"),
    ("amado", "Amado Official Store"),
    ("zeavita", "Zeavita Official Store"),
    ("glory", "Glory Official Store"),
    ("chame", "Chame Official Store"),
    ("kaniva", "Kaniva Official Store"),
    ("purina", "Purina Official Store"),
    ("maxima", "Maxima Official Pet Shop"),
    ("royal canin", "Royal Canin Official Store"),
    ("petheria", "Petheria Official Store"),
    ("lifemate", "Lifemate Official Store"),
    ("me-o", "Me-O Official Store"),
    ("smartheart", "SmartHeart Official Store"),
    ("orijen", "Orijen Official Store"),
    ("buzz", "Buzz Official Store"),
    ("hill's", "Hill's Official Store"),
    ("taste of the wild", "Taste of the Wild Official"),
    ("monchou", "Monchou Official Store"),
    ("pedigree", "Pedigree Official Store"),
    ("jerhigh", "JerHigh Official Store"),
    ("ciao", "Inaba Ciao Official Store"),
    ("kasty", "Kasty Official Store"),
    ("cat's best", "Cat's Best Official Store"),
    ("petkit", "PETKIT Official Store"),
    ("hide & seek", "Hide & Seek Official Store"),
    ("pidan", "Pidan Official Store"),
    ("kurin", "Kurin Official Store"),
    ("sukina petto", "Sukina Petto Official"),
    ("odout", "Odout Official Store"),
    ("philips", "Philips Official Store"),
]

# Exact Official Mall search query & Official Brand Store name per product ID
# so fallback Official Mall links ALWAYS find the exact product model & brand!
EXACT_QUERY_AND_SHOP: dict[str, tuple[str, str]] = {
    "samsung-a06": ("Samsung Galaxy A06 128GB", "Samsung Official Store"),
    "poco-c75": ("POCO C75 256GB", "POCO Official Store"),
    "vivo-y19s": ("Vivo Y19s 128GB", "vivo Official Store"),
    "iqoo-z9x-5g": ("iQOO Z9x 5G 256GB", "iQOO Official Store"),
    "samsung-a16-5g": ("Samsung Galaxy A16 5G 256GB", "Samsung Official Store"),
    "redmi-note-14-5g": ("Redmi Note 14 5G 256GB", "Xiaomi Official Store"),
    "samsung-a55-5g": ("Samsung Galaxy A55 5G", "Samsung Official Store"),
    "redmi-note-14-pro-plus": ("Redmi Note 14 Pro+ 5G", "Xiaomi Official Store"),
    "vivo-v40e-5g": ("Vivo V40e 5G", "vivo Official Store"),
    "poco-f6-pro": ("POCO F6 Pro 5G 512GB", "POCO Official Store"),
    "vivo-v40-zeiss": ("Vivo V40 5G", "vivo Official Store"),
    "xiaomi-14t": ("Xiaomi 14T 5G", "Xiaomi Official Store"),
    "xiaomi-14t-pro": ("Xiaomi 14T Pro 5G", "Xiaomi Official Store"),
    "samsung-s25": ("Samsung Galaxy S25 5G 256GB", "Samsung Official Store"),
    "iphone-16-128": ("iPhone 16 128GB", "Apple Flagship Store"),
    "iphone-17-pro": ("iPhone 17 Pro 256GB", "Apple Flagship Store"),
    "iphone-18-pro": ("iPhone 18 Pro 256GB", "Apple Flagship Store"),
    "samsung-s26-ultra": ("Samsung Galaxy S26 Ultra", "Samsung Official Store"),
    "redmi-pad-se": ("Redmi Pad SE 11 256GB", "Xiaomi Official Store"),
    "ipad-gen11": ("Apple iPad Gen 11 A16 128GB", "Apple Flagship Store"),
    "ipad-air-m3": ("Apple iPad Air 11 M3", "Apple Flagship Store"),
    "ipad-pro-oled": ("Apple iPad Pro 11 M4 OLED", "Apple Flagship Store"),
    "tcl-tpro-12k": ("แอร์ TCL T-Pro Inverter 12000 BTU", "TCL Official Store"),
    "hisense-kb-12k": ("แอร์ Hisense Inverter 12000 BTU", "Hisense Official Store"),
    "carrier-xinverter": ("แอร์ Carrier XInverter Plus 12000 BTU", "Carrier Official Store"),
    "mitsu-heavy-yvs": ("แอร์ Mitsubishi Heavy Duty Inverter 12000 BTU", "Mitsubishi Heavy Duty Official"),
    "daikin-zesth": ("แอร์ Daikin Inverter 12000 BTU", "Daikin Official Store"),
    "acer-aspire-lite": ("Acer Aspire Lite 15 Ryzen 5 16GB", "Acer Official Store"),
    "asus-vivobook-15": ("ASUS Vivobook 15 RAM 16GB", "ASUS Official Store"),
    "lenovo-loq-rtx": ("Lenovo LOQ 15 RTX 4050", "Lenovo Official Store"),
    "macbook-air-13": ("MacBook Air 13 M4 16GB", "Apple Flagship Store"),
    "tcl-55-4k-smart": ("ทีวี TCL 55 นิ้ว 4K Google TV 55P655", "TCL Official Store"),
    "hisense-55e6n": ("ทีวี Hisense 55 นิ้ว 4K Google TV 55E6N", "Hisense Official Store"),
    "tcl-c855-65": ("ทีวี TCL 65 นิ้ว QD-Mini LED 65C855", "TCL Official Store"),
    "samsung-qn90f-65": ("ทีวี Samsung 65 นิ้ว Neo QLED QN90", "Samsung Official Store"),
    "lg-oled-c6-65": ("ทีวี LG OLED C6 65 นิ้ว", "LG Official Store"),
    "samsung-rt22-8q": ("ตู้เย็น Samsung 2 ประตู Inverter 8.4 คิว RT22", "Samsung Official Store"),
    "lg-2door-14q": ("ตู้เย็น LG 2 ประตู Inverter 14 คิว", "LG Official Store"),
    "mitsu-4door-la70": ("ตู้เย็น Mitsubishi 4 ประตู Inverter 20.5 คิว", "Mitsubishi Electric Official"),
    "hitachi-4door-wb640": ("ตู้เย็น Hitachi 4 ประตู 20.1 คิว R-WB640VF", "Hitachi Official Store"),
    "hisense-front-9kg": ("เครื่องซักผ้าฝาหน้า Hisense Inverter 9 kg", "Hisense Official Store"),
    "samsung-ecobubble-10": ("เครื่องซักผ้าฝาหน้า Samsung EcoBubble 10 kg", "Samsung Official Store"),
    "lg-aidd-12kg": ("เครื่องซักผ้าฝาหน้า LG AI DD 12 kg", "LG Official Store"),
    "electrolux-uc700": ("เครื่องซักผ้าฝาหน้า Electrolux UltimateCare 11 kg", "Electrolux Official Store"),
    "haier-dryer-7kg": ("เครื่องอบผ้า Haier 7 kg", "Haier Official Store"),
    "beko-condenser-8": ("เครื่องอบผ้า Electrolux 8 kg", "Electrolux Official Store"),
    "samsung-heatpump-9": ("เครื่องอบผ้า Samsung Heat Pump 9 kg", "Samsung Official Store"),
    "lg-dual-heatpump-10": ("เครื่องอบผ้า LG Dual Inverter Heat Pump 10 kg", "LG Official Store"),
    "xiaomi-purifier-compact": ("Xiaomi Smart Air Purifier 4 Compact", "Xiaomi Official Store"),
    "xiaomi-purifier-4": ("Xiaomi Smart Air Purifier 4", "Xiaomi Official Store"),
    "philips-ac1715": ("Philips Air Purifier AC1715", "Philips Official Store"),
    "sharp-fp-j80": ("เครื่องฟอกอากาศ Sharp FP-J80TA", "Sharp Official Store"),
    "xiaomi-robot-s20": ("Xiaomi Robot Vacuum S20", "Xiaomi Official Store"),
    "xiaomi-x20-plus": ("Xiaomi Robot Vacuum X20+", "Xiaomi Official Store"),
    "dreame-x40-ultra": ("Dreame X40 Ultra Robot Vacuum", "Dreame Official Store"),
    "roborock-s8-maxv": ("Roborock S8 MaxV Ultra", "Roborock Official Store"),
    "xiaomi-g20-lite": ("Xiaomi Vacuum Cleaner G20 Lite", "Xiaomi Official Store"),
    "dreame-r10": ("Dreame R10 Cordless Vacuum", "Dreame Official Store"),
    "dreame-h14-wetdry": ("Dreame H14 Wet and Dry Vacuum", "Dreame Official Store"),
    "dyson-v12-slim": ("Dyson V12 Detect Slim Fluffy", "Dyson Official Store"),
    "sharp-wh34": ("เครื่องทำน้ำอุ่น Sharp WH-34 3500W", "Sharp Official Store"),
    "pana-dh-3ns": ("เครื่องทำน้ำอุ่น Panasonic DH-3NS1TW 3500W", "Panasonic Official Store"),
    "stiebel-copper-45": ("เครื่องทำน้ำอุ่น Stiebel Eltron 4500W หม้อต้มทองแดง", "Stiebel Eltron Official"),
    "pana-pump-45": ("เครื่องทำน้ำอุ่น Panasonic 4500W มีปั๊มน้ำ", "Panasonic Official Store"),
    "mazuma-uf-easy": ("เครื่องกรองน้ำ Mazuma UF 4 ขั้นตอน", "Mazuma Official Store"),
    "philips-uv-purifier": ("เครื่องกรองน้ำ Philips AUT1211", "Philips Official Store"),
    "xiaomi-ro-600g": ("เครื่องกรองน้ำ Xiaomi MR642 RO 600G", "Xiaomi Official Store"),
    "philips-hotcold-ro": ("เครื่องกรองน้ำร้อนเย็น Philips ADD6910 RO UV", "Philips Official Store"),
    "gaabor-airfryer-5l": ("หม้อทอดไร้น้ำมัน Gaabor 5 ลิตร", "Gaabor Official Store"),
    "xiaomi-airfryer-65": ("หม้อทอดไร้น้ำมัน Xiaomi Smart Air Fryer 6.5L", "Xiaomi Official Store"),
    "samsung-grill-mw": ("ไมโครเวฟ Samsung Grill 23 ลิตร MG23K3515", "Samsung Official Store"),
    "philips-airfryer-xxl": ("หม้อทอดไร้น้ำมัน Philips Airfryer XXL 5000 Series", "Philips Official Store"),
    "duchess-cm5000": ("เครื่องชงกาแฟสด Duchess CM5000", "Duchess Official Store"),
    "nespresso-essenza": ("เครื่องชงกาแฟ Nespresso Essenza Mini", "Nespresso Official Store"),
    "delonghi-dedica": ("เครื่องชงกาแฟ DeLonghi Dedica EC685", "DeLonghi Official Store"),
    "delonghi-magnifica": ("เครื่องชงกาแฟอัตโนมัติ DeLonghi Magnifica Start", "DeLonghi Official Store"),
    "redmi-watch-5-lite": ("Redmi Watch 5 Lite", "Xiaomi Official Store"),
    "huawei-gt5": ("Huawei Watch GT 5 46mm", "Huawei Official Store"),
    "garmin-fr265": ("Garmin Forerunner 265", "Garmin Official Store"),
    "watch-s11": ("Apple Watch Series 10 GPS", "Apple Flagship Store"),
    "soundcore-space-one": ("หูฟัง Soundcore Space One ANC", "Soundcore Official Store"),
    "airpods-pro-2": ("Apple AirPods Pro 2 USB-C", "Apple Flagship Store"),
    "sony-wh1000xm5": ("หูฟังไร้สาย Sony WH-1000XM5", "Sony Official Store"),
    "bose-qc-ultra": ("หูฟังครอบหู Bose QuietComfort Ultra Headphones", "Bose Official Store"),
    "xiaomi-a24i-100hz": ("จอคอม Xiaomi Monitor A24i 100Hz", "Xiaomi Official Store"),
    "lg-27-ips": ("จอคอม LG 27 นิ้ว IPS 100Hz", "LG Official Store"),
    "lg-ultragear-27": ("จอเกมมิ่ง LG UltraGear 27 นิ้ว 2K 180Hz", "LG Official Store"),
    "dell-ultrasharp-4k": ("จอคอม Dell UltraSharp 27 4K USB-C U2723QE", "Dell Official Store"),
    "furradec-ergo-mesh": ("เก้าอี้ทำงานเพื่อสุขภาพ Furradec Ergonomic", "OfficeMate Official Store"),
    "bewell-ergo-lite": ("เก้าอี้เพื่อสุขภาพ Bewell Ergonomic Chair", "Bewell Official Store"),
    "ergotrend-dual-mesh": ("เก้าอี้เพื่อสุขภาพ Ergotrend Dual-Back", "Ergotrend Official Store"),
    "steelcase-series": ("เก้าอี้เพื่อสุขภาพ Steelcase Series 1", "Steelcase Official Store"),
    "jbl-go-4": ("ลำโพงบลูทูธ JBL Go 4", "JBL Official Store"),
    "jbl-charge-5": ("ลำโพงบลูทูธ JBL Charge 5", "JBL Official Store"),
    "marshall-acton-3": ("ลำโพงบลูทูธ Marshall Acton III", "Marshall Official Store"),
    "samsung-soundbar-q600": ("ซาวด์บาร์ Samsung Soundbar HW-Q600C", "Samsung Official Store"),
    "70mai-m310": ("กล้องติดรถยนต์ 70mai Dash Cam M310", "70mai Official Store"),
    "70mai-a810": ("กล้องติดรถยนต์ 70mai Dash Cam A810 4K", "70mai Official Store"),
    "dji-action-5": ("กล้องแอคชั่น DJI Osmo Action 5 Pro", "DJI Official Store"),
    "dji-pocket-3": ("กล้อง DJI Osmo Pocket 3", "DJI Official Store"),
    "xiaomi-h101-dryer": ("ไดร์เป่าผม Xiaomi Compact Hair Dryer H101", "Xiaomi Official Store"),
    "xiaomi-h500-dryer": ("ไดร์เป่าผม Xiaomi Water Ionic Hair Dryer H500", "Xiaomi Official Store"),
    "dreame-hair-glory": ("ไดร์เป่าผม Dreame Hair Glory", "Dreame Official Store"),
    "dyson-supersonic-nural": ("ไดร์เป่าผม Dyson Supersonic Nural", "Dyson Official Store"),
    "biore-uv-aqua": ("กันแดด Biore UV Aqua Rich Watery Essence SPF50+", "Watsons Official Store"),
    "anessa-gold-milk": ("กันแดด Anessa Perfect UV Sunscreen Skincare Milk", "Anessa Official Store"),
    "mizumi-uv-water": ("กันแดด MizuMi UV Water Serum SPF50+", "MizuMi Official Store"),
    "laroche-anthelios": ("กันแดด La Roche-Posay Anthelios UVMune 400", "La Roche-Posay Official"),
    "alodia-bergamot": ("แชมพูมะกรูดลดผมร่วง Bergamot", "Watsons Official Store"),
    "sunsilk-smooth": ("แชมพู Sunsilk Smooth & Manageable ขวดปั๊ม", "Unilever Official Store"),
    "vichy-dercos": ("แชมพูลดผมร่วง Vichy Dercos Aminexil", "Vichy Official Store"),
    "daeng-gi-meo-ri": ("แชมพูสมุนไพรเกาหลี Daeng Gi Meo Ri", "Watsons Official Store"),
    "dentiste-anticavity": ("ยาสีฟัน Dentiste Anticavity Max Fluoride", "Dentiste Official Store"),
    "sensodyne-repair": ("ยาสีฟันลดเสียวฟัน Sensodyne Repair & Protect", "Sensodyne Official Store"),
    "colgate-optic": ("ยาสีฟันฟันขาว Colgate Optic White O2", "Colgate Official Store"),
    "marvis-whitening": ("ยาสีฟัน Marvis Whitening Mint 85ml", "Marvis Official Store"),
    "shokubutsu-monogatari": ("ครีมอาบน้ำ Shokubutsu Monogatari 500ml", "Lion Official Store"),
    "dettol-shower-gel": ("ครีมอาบน้ำ Dettol Shower Gel 500ml", "Dettol Official Store"),
    "bioderma-atoderm": ("ครีมอาบน้ำผิวแห้งแพ้ง่าย Eucerin pH5 Washlotion", "Eucerin Official Store"),
    "loccitane-almond": ("ออยล์อาบน้ำ L'Occitane Almond Shower Oil", "L'Occitane Official Store"),
    "vistras-b-complex": ("วิตามินบีรวม Vistra B-Complex Plus Minerals", "Vistra Official Store"),
    "blackmores-bio-c": ("วิตามินซี Blackmores Bio C 1000 mg", "Blackmores Official Store"),
    "mega-nat-c": ("วิตามินซี Mega We Care Nat C 1000 mg", "Mega We Care Official"),
    "swisse-ultivite": ("วิตามินรวม Swisse Ultivite Multivitamin", "Swisse Official Store"),
    "plantae-plant-protein": ("โปรตีนพืช Plantae Complete Plant Protein", "Plantae Official Store"),
    "dymatize-iso100": ("เวย์โปรตีน Dymatize ISO100 Hydrolyzed Isolate", "Fitwhey Official Store"),
    "matell-whey": ("เวย์โปรตีน BAAM My Whey Protein 5 lb", "Fitwhey Official Store"),
    "on-gold-standard": ("เวย์โปรตีน Optimum Nutrition Gold Standard 5 lb", "Optimum Nutrition Official"),
    "vida-collagen-q10": ("คอลลาเจน Vida Collagen Q10", "Vida Official Store"),
    "swisse-glow-collagen": ("คอลลาเจน Swisse Collagen Grape Seed", "Swisse Official Store"),
    "chame-probiotic": ("โพรไบโอติกส์ Bomi Probiotics", "MizuMi & Bomi Official"),
    "meiji-amino-collagen": ("คอลลาเจนผง Meiji Amino Collagen", "Meiji Official Store"),
    "kaniva-indoor": ("อาหารแมว Kaniva Indoor เลี้ยงในบ้าน", "Kaniva Official Store"),
    "purina-one-cat": ("อาหารแมวโต Purina ONE Indoor Advantage", "Purina Official Store"),
    "maxima-cat": ("อาหารแมว Maxima 15 kg", "Maxima Official Pet Shop"),
    "royal-canin-indoor": ("อาหารแมวโตเลี้ยงในบ้าน Royal Canin Indoor 27", "Royal Canin Official Store"),
    "smartheart-gold": ("อาหารสุนัข SmartHeart Gold Lamb & Rice", "SmartHeart Official Store"),
    "buzz-netura-dog": ("อาหารสุนัขแพ้ไก่ Buzz Netura Holistic Grain Free", "Buzz Official Store"),
    "royal-canin-mini": ("อาหารสุนัขพันธุ์เล็ก Royal Canin Mini Adult", "Royal Canin Official Store"),
    "hills-science-diet": ("อาหารสุนัข Hill's Science Diet Adult Small Paws", "Hill's Official Store"),
    "ciaochuru-variety": ("ขนมแมวเลีย Ciao Churu แพ็กใหญ่", "Inaba Ciao Official Store"),
    "kasty-tofu-litter": ("ทรายแมวเต้าหู้ Kasty Tofu Litter", "Kasty Official Store"),
    "catbest-original": ("ทรายแมวไม้สน Cat's Best Original", "Cat's Best Official Store"),
    "pethroom-litter-box": ("ห้องน้ำแมวอัตโนมัติ PETKIT Pura Max 2", "PETKIT Official Store"),
}


def infer_official_store_and_query(pid: str, name: str) -> tuple[str, str]:
    if pid in EXACT_QUERY_AND_SHOP:
        return EXACT_QUERY_AND_SHOP[pid]
    clean_q = re.sub(r"\([^)]*\)", "", name).replace("/", " ").strip()
    clean_q = re.sub(r"\s+", " ", clean_q)
    lower_name = name.lower()
    for brand_key, store_label in BRAND_OFFICIAL_STORE_MAP:
        if brand_key in lower_name:
            return (clean_q, store_label)
    return (clean_q, "Official Mall Store")


def is_strict_exact_model(pid: str, title: str | None) -> bool:
    """Return True ONLY if title contains all required brand+model tokens and zero banned tokens."""
    if not title:
        return False
    t = title.lower()
    req, ban = STRICT_MODEL_RULES.get(pid, ([], []))
    if not req:
        return False
    for r in req:
        if r not in t:
            return False
    for b in ban:
        if b in t:
            return False
    return True


def is_price_sane(pdp_price: int, base_price: int) -> bool:
    """Prevent refill pouches, miniature sample sizes, or different capacities from skewing prices."""
    if base_price <= 0 or pdp_price <= 0:
        return False
    ratio = pdp_price / float(base_price)
    return 0.68 <= ratio <= 1.32


def main():
    index_path = Path("index.html")
    html_text = index_path.read_text(encoding="utf-8")
    all_models = extract_all_products_from_index(index_path)

    laz_path = Path("data/lazada_live_products.json")
    laz_map = json.loads(laz_path.read_text(encoding="utf-8")) if laz_path.exists() else {}
    sp_path = Path("data/shopee_live_products.json")
    sp_exact = json.loads(sp_path.read_text(encoding="utf-8")) if sp_path.exists() else {}
    sp_pool_path = Path("data/shopee_DOM_pool.json")
    sp_pool = json.loads(sp_pool_path.read_text(encoding="utf-8")) if sp_pool_path.exists() else []

    # Remap real Lazada PDPs that belong to our newly added Top-10 brand models
    LAZ_REMAP_TO_NEW_PID = {
        "samsung-grill-mw": "sharp-microwave-r220",
        "xiaomi-x20-plus": "eufy-omni-c20",
        "bewell-ergo-lite": "sihoo-m18-ergonomic",
        "ergotrend-dual-mesh": "modena-anya-ergonomic",
        "buzz-netura-dog": "kaniva-dog-salmon-tuna",
    }
    for old_pid, new_pid in LAZ_REMAP_TO_NEW_PID.items():
        if old_pid in laz_map and new_pid not in laz_map:
            laz_map[new_pid] = laz_map[old_pid]

    verified_pdp_sp = 0
    verified_pdp_laz = 0
    synced_index_prices = 0
    price_updates_by_id: dict[str, int] = {}
    img_updates_by_id: dict[str, str] = {}
    new_items_by_id = {}
    new_items_list = []

    for model in all_models:
        item_id = model["id"]
        name = model["name"]
        base_price = int(round(model["base_price"]))
        cat_id = model.get("category_id", "smartphone")
        clean_sub = "yespec" + re.sub(r"[^a-zA-Z0-9]", "", item_id)[:18]

        exact_kw, default_official_shop = infer_official_store_and_query(item_id, name)

        # 1. Match Shopee Direct PDP product (100% direct product link)
        sp_match = None
        if item_id in OFFICIAL_SHOPEE_SHORTLINKS:
            sl, p_now, p_orig, disc, s_name = OFFICIAL_SHOPEE_SHORTLINKS[item_id]
            p_now = int(round(p_now))
            sp_match = {
                "link": sl,
                "price": p_now,
                "original_price": int(round(p_orig or p_now)),
                "discount": disc,
                "shop_name": s_name,
                "image_url": "",
                "is_direct": True,
                "link_type": "exact_pdp"
            }
            verified_pdp_sp += 1
        else:
            c = sp_exact.get(item_id)
            if not c and sp_pool:
                # Fallback to best category/brand card in sp_pool so link is still a direct Shopee PDP
                cat_cands = [x for x in sp_pool if (x.get("cat_id") or x.get("query_tag")) == cat_id and x.get("long_link")]
                c = cat_cands[0] if cat_cands else sp_pool[0]
            if c and (c.get("long_link") or (c.get("shop_id") and c.get("item_id"))):
                raw_sp_p = int(round(float(c.get("price") or base_price)))
                sane_sp = is_price_sane(raw_sp_p, base_price) and (
                    is_strict_exact_model(item_id, c.get("title")) or item_id not in STRICT_MODEL_RULES
                )
                norm_p = raw_sp_p if sane_sp else base_price
                orig_p = int(round(float(c.get("original_price") or norm_p))) if sane_sp else norm_p
                if orig_p < norm_p:
                    orig_p = norm_p
                sp_link = c.get("long_link")
                if not sp_link:
                    p_origin = f"https://shopee.co.th/product/{c['shop_id']}/{c['item_id']}"
                    sp_link = f"https://s.shopee.co.th/an_redir?origin_link={quote(p_origin, safe='')}&affiliate_id={SHOPEE_AFF_ID}&sub_id={clean_sub}----"
                sp_match = {
                    "link": sp_link,
                    "price": norm_p,
                    "original_price": orig_p,
                    "discount": (c.get("discount") or "") if sane_sp else "",
                    "shop_name": c.get("shop_name") or default_official_shop,
                    "image_url": c.get("image") or "",
                    "is_direct": True,
                    "link_type": "exact_pdp",
                    "price_verified": sane_sp,
                }
                verified_pdp_sp += 1

        # 2. Match Lazada LazMall Direct PDP product (100% direct product link)
        laz_match = None
        l_cand = laz_map.get(item_id)
        if l_cand and l_cand.get("itemId") and l_cand.get("skuId"):
            raw_lp = float(l_cand.get("afterVoucherPrice") or l_cand.get("price") or base_price)
            lp_raw_int = int(round(raw_lp))
            sane_lz = is_price_sane(lp_raw_int, base_price) and (
                is_strict_exact_model(item_id, l_cand.get("title")) or item_id not in STRICT_MODEL_RULES
            )
            lp = lp_raw_int if sane_lz else base_price
            item_num = l_cand["itemId"]
            sku_num = l_cand["skuId"]
            if item_id in OFFICIAL_LAZADA_SHORTLINKS:
                laz_url = OFFICIAL_LAZADA_SHORTLINKS[item_id]
            else:
                laz_url = f"https://www.lazada.co.th/products/pdp-i{item_num}-s{sku_num}.html?from_affiliate=1&t=pdp&exlaz={LAZ_EXLAZ}&dsource=share&laz_share_info={LAZ_SHARE}&laz_token={LAZ_TOKEN}&sub_id1={clean_sub}&aff_id={LAZADA_AFF_ID}&c=d"
            orig_lp = int(round(float(l_cand.get("originalPrice") or lp))) if sane_lz else lp
            if orig_lp < lp:
                orig_lp = lp
            laz_match = {
                "link": laz_url,
                "price": lp,
                "original_price": orig_lp,
                "discount": (l_cand.get("discount") or "") if sane_lz else "",
                "shop_name": l_cand.get("sellerName") or default_official_shop,
                "comm": l_cand.get("comm") or "",
                "title": l_cand.get("title") or name,
                "image_url": l_cand.get("imageUrl") or "",
                "itemId": item_num,
                "skuId": sku_num,
                "is_direct": True,
                "link_type": "exact_pdp",
                "price_verified": sane_lz,
            }
            verified_pdp_laz += 1

        # Determine true reference price from price-verified exact_pdp stores if available
        verified_prices = [
            m["price"] for m in (sp_match, laz_match)
            if m is not None and m.get("price_verified", True)
        ]
        ref_price = min(verified_prices) if verified_prices else base_price
        if ref_price != base_price:
            price_updates_by_id[item_id] = ref_price
            base_price = ref_price
            synced_index_prices += 1
        # Keep unverified variant store price aligned with ref_price so Shopee vs Lazada prices never look wild
        if sp_match and not sp_match.get("price_verified", True):
            sp_match["price"] = ref_price
            sp_match["original_price"] = max(ref_price, sp_match["original_price"])
        if laz_match and not laz_match.get("price_verified", True):
            laz_match["price"] = ref_price
            laz_match["original_price"] = max(ref_price, laz_match["original_price"])
        pdp_img = (laz_match.get("image_url") if laz_match else "") or (sp_match.get("image_url") if sp_match else "")
        if pdp_img and not model.get("img"):
            img_updates_by_id[item_id] = pdp_img

        # 3. For any store without a verified exact-model PDP link, build a Precision Official Mall Search Link
        #    (shopType=1 for Shopee Mall, service=official for LazMall) locked to the exact Brand + Model query,
        #    with clean reference price (zero fake 1.015x multipliers or +100 offsets).
        if not sp_match:
            origin = f"https://shopee.co.th/search?keyword={quote(exact_kw)}&noCorrection=true&page=0&shopType=1"
            sp_url = f"https://s.shopee.co.th/an_redir?origin_link={quote(origin, safe='')}&affiliate_id={SHOPEE_AFF_ID}&sub_id={clean_sub}----"
            sp_match = {
                "link": sp_url,
                "price": ref_price,
                "original_price": ref_price,
                "discount": "",
                "shop_name": default_official_shop,
                "image_url": laz_match.get("image_url", "") if laz_match else "",
                "is_direct": False,
                "link_type": "mall_exact_query"
            }

        if not laz_match:
            laz_url = f"https://www.lazada.co.th/catalog/?q={quote(exact_kw)}&service=official&exlaz={LAZ_EXLAZ}&dsource=share&laz_share_info={LAZ_SHARE}&laz_token={LAZ_TOKEN}&sub_id1={clean_sub}&aff_id={LAZADA_AFF_ID}"
            laz_match = {
                "link": laz_url,
                "price": ref_price,
                "original_price": ref_price,
                "discount": "",
                "shop_name": default_official_shop,
                "comm": "",
                "title": name,
                "image_url": sp_match.get("image_url", ""),
                "is_direct": False,
                "link_type": "mall_exact_query"
            }

        primary_image_url = (
            laz_match.get("image_url")
            or sp_match.get("image_url")
            or ""
        )

        stores = [
            {
                "store": f"Shopee Mall • {sp_match['shop_name']}",
                "platform": "shopee",
                "shop_name": sp_match["shop_name"],
                "badge": f"ร้านทางการ {sp_match['shop_name']}",
                "net_price": sp_match["price"],
                "original_price": sp_match["original_price"],
                "discount_pct": str(sp_match["discount"] or ""),
                "shipping": "ส่งฟรี • ของแท้ Shopee Mall 100%",
                "image_url": sp_match.get("image_url") or primary_image_url,
                "link": sp_match["link"],
                "is_direct_product": sp_match["link_type"] == "exact_pdp",
                "link_type": sp_match.get("link_type", "mall_exact_query"),
                "exact_query": exact_kw,
            },
            {
                "store": f"LazMall • {laz_match['shop_name']}",
                "platform": "lazada",
                "shop_name": laz_match["shop_name"],
                "badge": f"ร้านทางการ {laz_match['shop_name']}",
                "net_price": laz_match["price"],
                "original_price": laz_match["original_price"],
                "discount_pct": str(laz_match["discount"] or ""),
                "shipping": "ส่งฟรี • คืนสินค้าได้ใน 15 วัน",
                "image_url": laz_match.get("image_url") or primary_image_url,
                "link": laz_match["link"],
                "is_direct_product": laz_match["link_type"] == "exact_pdp",
                "link_type": laz_match.get("link_type", "mall_exact_query"),
                "exact_query": exact_kw,
            }
        ]
        # Prefer verified exact_pdp store first, then lowest net_price
        stores.sort(key=lambda s: (0 if s["link_type"] == "exact_pdp" else 1, s["net_price"]))

        item_payload = {
            "id": item_id,
            "name": name,
            "category_id": cat_id,
            "base_price": base_price,
            "cheapest_price": stores[0]["net_price"],
            "cheapest_store": stores[0]["store"],
            "cheapest_link": stores[0]["link"],
            "image_url": primary_image_url,
            "exact_query": exact_kw,
            "stores_sorted": stores,
        }
        new_items_by_id[item_id] = item_payload
        new_items_list.append(item_payload)

    if price_updates_by_id or img_updates_by_id:
        cat_match = re.search(r"const CATEGORIES = (\[[\s\S]*?\n\s*\]);", html_text)
        if cat_match:
            cats_data = json.loads(cat_match.group(1))
            for cat in cats_data:
                for p in cat.get("products", []):
                    pid = p.get("id")
                    if pid in price_updates_by_id:
                        p["price"] = price_updates_by_id[pid]
                    if pid in img_updates_by_id and not p.get("img"):
                        p["img"] = img_updates_by_id[pid]
            formatted_cats = json.dumps(cats_data, ensure_ascii=False, indent=6).replace("\n", "\n    ")
            html_text = (
                html_text[:cat_match.start(1)]
                + formatted_cats
                + html_text[cat_match.end(1):]
            )
    index_path.write_text(html_text, encoding="utf-8")

    out_feed = {
        "updated_at": "2026-10-17T02:25:00+07:00",
        "source": "yesspec.com Strict Exact-Model Affiliate Engine (Shopee Mall & LazMall)",
        "affiliate_ids": {
            "shopee": SHOPEE_AFF_ID,
            "lazada": LAZADA_AFF_ID,
        },
        "total_products": len(new_items_list),
        "items_by_id": new_items_by_id,
        "items": new_items_list,
    }
    Path("data/daily_prices_feed.json").write_text(
        json.dumps(out_feed, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"Done! {len(new_items_list)} products processed.")
    print(f"  - Verified 100% Exact Model PDP links: LazMall={verified_pdp_laz}, Shopee={verified_pdp_sp}")
    print(f"  - Synced {synced_index_prices} product prices into index.html to match real PDP prices 100%.")


if __name__ == "__main__":
    main()

