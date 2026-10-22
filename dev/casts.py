import json
LEO={"name":"Leo","kind":"human","age":"teen","gender":"m","accessories":["glasses","backpack"],"hair":{"style":"swept","color":4861727},"skin":15516842,"seed":11,"outfitColor":5926794}
MIA={"name":"Mia","kind":"human","age":"teen","gender":"f","accessories":["earrings"],"hair":{"style":"wavy","color":4861727},"skin":15190954,"seed":23}
def bald(c): c=dict(c); c["hair"]={"style":"bald","color":c["hair"]["color"]}; c["accessories"]=[]; return c
