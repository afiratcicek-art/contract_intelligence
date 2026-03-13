## Contract Intelligence Agent -- Hafta 1
## print("Contract Intelligence Agent Calismalarina Basliyorum")
## RFI Bilgileri
## rfi_numarasi = 'RFI-ARC-001'
## Proje_Adi = 'Farazi İnsaat Projem'
## rfi_yanıt_suresi_gun = 14
## delay_impact = False
## int [rfi_yanit_suresi_2_gun] = 15 bu C# daki gibi değil, calismiyor
## print(Proje_Adi)
## print(rfi_numarasi)
##print(delay_impact)
############################
# Farazi Senaryo - RFI Gonderildi ve bilgiler varsayıldı, RFI cevabı için deadline hesaplanacak, bi de kalan gun sayısı olsun
## from datetime import date, timedelta
## rfi_numarasi = 'RFI-ARC-001'
## rfi_konusu = 'Bina Kuzey Cephe Duvari Mimari Detaylari Hakkinda'
## rfi_gonderim_tarihi = date(2026,2,22) ## Bugun, Bu fonksiyonlar import edilmeli
## bugun = date.today()
## Sozlesme_Geregi_Cevap_Suresi = 14
## Deadline = rfi_gonderim_tarihi + timedelta(Sozlesme_Geregi_Cevap_Suresi) ## Timedelta da import edilmeli
## kalan_gun = (Deadline - bugun).days
## Delay_impact = True if kalan_gun < 0 else False
## print("RFI Numarası:",rfi_numarasi)
## print("RFI Konusu:",rfi_konusu)
## print("RFI Gonderim Tarihi",rfi_gonderim_tarihi)
## print("Deadline :",Deadline)
## print(kalan_gun)
## print(Delay_impact)
## rfi_listesi = ['RFI-001: Cephe Duvari Mimari Detay','RFI-002: Temel Dizayni','RFI-003: ACP Panel']
## for rfi in rfi_listesi:
##    print(rfi)
## print("Toplam RFI:",len(rfi_listesi))
## from datetime import date,timedelta
## notice_period = 14
## yapilanmis_rfi = {"RFI_Numarasi":"RFI-001","RFI_konusu":"Cephe_Mimari_Detayi","Proje":"Benim_Farazi_Projem","RFI_tarihi" : date(2026,2,15),"RFI_Statusu": "Cevap_Bekliyor","Notice_Suresi":notice_period }
## deadline = yapilanmis_rfi["RFI_tarihi"] + timedelta(days=yapilanmis_rfi["Notice_Suresi"])
## print( "RFI_NUMARASI: ",yapilanmis_rfi["RFI_Numarasi"])
## print("RFI_KONUSU: ",yapilanmis_rfi["RFI_konusu"])
## print("DEADLINE: ",deadline)


## from datetime import date, timedelta
## burada deadline_hesapla diye bir fonksiyon olusturdum ve bunu iki değişkene bağladım

## rfi_yanit_suresi_gun = 14
## rfi_numarasi1 = 'RFI-ARC-001'
## rfi_tarihi1 = date(2026,2,22)

## def deadline_hesapla (rfi_tarihi, cevap_suresi):  
## deadline = rfi_tarihi + timedelta(days=cevap_suresi)
## kalan_gun = (deadline - date.today()).days
## return deadline, kalan_gun


## Farazi Projemizden Farazi Ornekler


## deadline1, kalan_gun1 = deadline_hesapla (rfi_tarihi1,rfi_yanit_suresi_gun)

## print (rfi_numarasi1, "Deadline :",deadline1,"Kalan_GUN:",kalan_gun1,"gun")

## if kalan_gun1 <0 :
## print ("MUSKILAAAAA!!!!!!!!")


###------- SIMDI HARMANLAYIP, KULLANMA ZAMANI ----------------
from datetime import date, timedelta
notice_suresi_gun = 14


rfi_listesi = [
    {"numara":"RFI-ARC-001",
     "konu":"cephe isleri detayi",
     "tarih": date(2026,2,26),
     "notice_suresi_gun":notice_suresi_gun,
     "kritik_etki" : True,
     },
    {
        "numara":"RFI-ARC-002",
        "konu":"CMU duvar isleri detayi",
        "tarih": date(2026,2,20),
        "notice_suresi_gun":notice_suresi_gun,
        "kritik_etki" : False,
    },
     {
        "numara":"RFI-ARC-003",
        "konu":"mermer isleri detayi",
        "tarih": date(2026,3,1),
        "notice_suresi_gun":notice_suresi_gun,
        "kritik_etki" : False,
    }
    ]



def deadline_hesapla (rfi_tarihi,cevap_suresi):
    deadline = rfi_tarihi + timedelta(days=cevap_suresi)
    kalan_gun = (deadline - date.today()).days
    return deadline, kalan_gun

def durum_nedir (kalan_gun, kritik_etki):
    if kalan_gun <0:
        durum = "ISKALADIK"
    elif kalan_gun <3:
        durum = "DIKKKAAATTT!!"
    else :
        durum = "NORMALIMSI"

    
    if kritik_etki == True:
        durum += " | KRITIK ETKI VAR"

    return durum


def rfi_raporla (rfi):
    deadline, kalan_gun = deadline_hesapla(rfi["tarih"],rfi["notice_suresi_gun"])
    durum = durum_nedir(kalan_gun,rfi["kritik_etki"])
    print(f"{rfi['numara']} - {rfi['konu']}")
    print(f"Deadline: {deadline}")
    print(f" Kalan : {kalan_gun} gun")
    durum = durum_nedir(kalan_gun, rfi["kritik_etki"])    ## Strıng ıcınde fonksıyon calıstıramadıgım ıcın, once her RFI ıcın calıstırıp, sonra strıng e cagırıyorum.
    print(f"DURUM: {durum}")

print("="*50)
print ("CONTRACT INTELLIGENCE AGENT - RFI TAKIP SISTEMI DENEMESI")
print ("="*50)
for rfi in rfi_listesi:
    rfi_raporla (rfi)





