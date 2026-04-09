# Metin2 Panel Bot v8 Secure

Bu sürümde güvenlik için Discord bot tokeni ve sunucu ID panelden kaldırıldı.
Hassas bilgiler sadece `.env` dosyasından okunur ve `data/config.json` içine yazılmaz.

## Kurulum
1. `npm install`
2. `.env.example` dosyasını `.env` olarak kopyala
3. `.env` içine kendi değerlerini yaz:
   - `BOT_TOKEN`
   - `GUILD_ID`
   - `PANEL_PASSWORD`
   - `SESSION_SECRET`
4. `npm start`
5. Tarayıcıdan `http://localhost:3000`

## VDS için öneri
- `.env` dosyasını kimseyle paylaşma
- projeyi bir repoya atıyorsan `.gitignore` içindeki `.env` satırını silme
- token sızarsa Discord Developer Portal üzerinden hemen yenile

## Not
- Panel içinde artık token gösterilmez
- Sunucu ID gösterilmez
- Ayarlar ekranında sadece ayarlı / eksik bilgisi görünür


## v13 ultra
- Üye listeleme için rate limit fix eklendi.
- Sol üst logo ARKANTOS2 görseli ile güncellendi.
- Dashboard üstündeki modern gösterge paneli yazısı kaldırıldı.


## v14 yenilikleri
- Aktivite puanı
- Rozet sistemi ve panelden eşik ayarı
- Son aktif süresi
- Son hareketler paneli
- Premium profil sayfası
- ARKANTOS2 yazısı küçültüldü


## v15 canlı tema
- Puan ve rozet sütunları kaldırıldı
- Canlı dashboard yenileme eklendi (5 sn)
- Turkey timezone zorlandı (Europe/Istanbul)
- Dark + Gold premium tema güçlendirildi


## v18 veri kaybolmaz + backup sistemi
- Veriler artik varsayilan olarak `/root/panel-data` dizininde tutulur.
- Proje klasorunu silsen bile mesaj sayilari korunur.
- Ayarlar ekranindan tek tikla yedek alinabilir.
- Manuel yedek scripti: `bash scripts/backup-data.sh`
- Eski data klasorunu tasima scripti: `bash scripts/restore-legacy-data.sh`
- Istersen `.env` icinde `DATA_DIR=/root/panel-data` satirini degistirerek veri konumunu ozellestirebilirsin.

### Guvenli guncelleme
```bash
cd /root
unzip -o metin2-panel-bot-v18-persistent-backup.zip
cd /root/metin2-panel-bot
npm install
pm2 restart metin2-panel
```
Bu yontem veri kaybetmez.


## v18.1 düzeltmeleri
- Ayarlar sayfasındaki rozet sistemi kaldırıldı.
- Otomatik saatlik yedekleme aktif edildi.
- Uygulama açılışında da bir başlangıç yedeği alınır.
