# Hnaya DZ Browser 0.7.7

*Note de version trilingue — à coller dans la publication GitHub.
Langues : [Français](#français) · [English](#english) · [العربية](#العربية)*

---

## Français

### Une messagerie interne qui ne sort pas de vos murs

Cette version transforme la messagerie locale en outil de travail
complet : ce qui était une conversation d'équipe devient un circuit de
décision. Tout reste sur votre réseau — aucun serveur distant, aucun
compte, aucun abonnement.

**Décider, pas seulement discuter**

- **Demandes qualifiées** — un envoi porte une étiquette (Pour info, Avis,
  Validation, Approbation) et peut désigner **un destinataire précis**. La
  décision — Validé, Refusé, Réserves — reste attachée à la demande, avec
  son auteur et son horodatage, **signée cryptographiquement**. Plus de
  doute sur qui a validé quoi. Une pièce jointe peut accompagner la
  demande : valider « le rapport » veut dire valider ce fichier-là.
- **Votes** — nominatifs ou non, dépouillés par personne et non par
  appareil.
- **Réunions** — annoncées dans le salon, épinglées avec leur compte à
  rebours, rappelées par une notification Windows **quinze minutes avant**
  même navigateur fermé, exportables vers Outlook ou Thunderbird
  (`.ics` déposé dans `Documents\Hnaya\Agenda`). Une réunion se **décale**
  ou s'**annule** : la nouvelle heure s'affiche, l'ancienne reste barrée,
  et l'on voit qui a décidé du changement.

**Savoir à qui l'on parle**

- **Annuaire** du salon : qui est là, sa fonction dans l'organisation
  (DRH, DGA…), sa présence. Un clic ouvre une conversation privée.
- **Photos de profil** — ou des initiales colorées à défaut, stables et
  distinctives. Elles accompagnent désormais chaque prise de parole dans
  le fil.
- **Accusés de lecture** par personne, sous vos propres messages
  seulement.
- **Un seul nom pour vos deux appareils** : votre téléphone se rattache à
  votre poste, et vous ne comptez qu'une voix dans un vote.
- **Le nom du salon est affirmé** là où vous écrivez — un bandeau et
  jusque dans le champ de saisie. Se tromper de salon, c'est adresser un
  document à la mauvaise direction.

**Envoyer autre chose que du texte**

Images, documents (PDF, Word, Excel…) et **messages vocaux**, jusqu'à
25 Mio. Vous pouvez **vous réécouter avant d'envoyer**. Et vous pouvez
vous **envoyer un fichier à vous-même**, de votre poste à votre téléphone.

**Depuis un téléphone, sans rien installer**

Une page web servie sur votre wifi interne : ni application, ni magasin
d'applications. Elle a été retravaillée pour tenir sur les écrans étroits,
et vous avertit si l'option « Site pour ordinateur » de votre navigateur
la rend illisible.

### Serveur permanent — prestation sous licence

- **Plusieurs salons derrière une seule adresse** : Salon général,
  Direction, DRH… un seul service à installer, une seule base à
  sauvegarder, un annuaire commun. Chaque salon garde son propre code
  d'accès, qui est aussi sa clé de chiffrement : le cloisonnement est
  réel.
- **Composer un salon avant l'arrivée de ses membres** — l'administrateur
  désigne les participants depuis l'annuaire, et le salon naît fermé.
- **Licence opposable** : préavis à l'approche de l'échéance, puis
  **30 jours** de grâce, puis lecture seule. L'historique reste toujours
  consultable. Les places d'appareils se libèrent quand un poste est
  remplacé.

### Corrections notables

- L'icône de la barre des tâches était remplacée par une icône générique.
- Les notifications Windows ne paraissaient pas du tout.
- Le journal de la base n'était jamais reversé, et grossissait sans fin.
- Le fichier d'agenda partait dans un dossier temporaire, effacé par
  Windows.
- Ouverture de la messagerie sensiblement plus rapide.

### Socle

Moteur **Electron 43**, avec les correctifs de sécurité Chromium
correspondants.

### Installation

Téléchargez l'installateur ci-joint. **Windows peut afficher un
avertissement** : l'exécutable n'est pas encore signé par un certificat
commercial. Si vous venez d'une version 0.7.x précédente, désinstallez-la
d'abord.

Licence pour le serveur permanent : **+213 558 303 030** ·
**contact@hnaya.dz**

---

## English

### Internal messaging that never leaves your walls

This release turns the local messaging module into a complete working
tool: what was a team conversation becomes a decision trail. Everything
stays on your network — no remote server, no account, no subscription.

**Decide, not just discuss**

- **Qualified requests** — a message carries a label (For information,
  Opinion, Validation, Approval) and can name **a single recipient**. The
  decision — Approved, Refused, Reservations — stays attached to the
  request with its author and timestamp, **cryptographically signed**. No
  more doubt about who approved what. An attachment can accompany the
  request: approving "the report" means approving *that* file.
- **Votes** — named or anonymous, counted per person rather than per
  device.
- **Meetings** — announced in the room, pinned with a countdown, recalled
  by a native Windows notification **fifteen minutes before** even with
  the browser closed, exportable to Outlook or Thunderbird (`.ics` saved
  to `Documents\Hnaya\Agenda`). A meeting can be **moved** or
  **cancelled**: the new time appears, the old one stays struck through,
  and you can see who decided the change.

**Know who you are talking to**

- **Directory** of the room: who is present, their role in the
  organisation, their availability. One click opens a private thread.
- **Profile photos** — or coloured initials otherwise, stable and
  distinctive. They now accompany every turn of speech in the thread.
- **Read receipts** per person, under your own messages only.
- **One name for your two devices**: your phone attaches to your
  workstation, and you count as a single voice in a vote.
- **The room name is asserted** where you write — a banner, and in the
  input field itself. Picking the wrong room means sending a document to
  the wrong department.

**Send more than text**

Images, documents (PDF, Word, Excel…) and **voice messages**, up to
25 MiB. You can **listen back before sending**. And you can **send a file
to yourself**, from your workstation to your phone.

**From a phone, with nothing to install**

A web page served over your internal wifi: no app, no app store. It has
been reworked to fit narrow screens, and warns you if your browser's
"Desktop site" option is making it unreadable.

### Permanent server — licensed offering

- **Several rooms behind a single address**: General, Management, HR… one
  service to install, one database to back up, a shared directory. Each
  room keeps its own access code, which is also its encryption key — the
  partitioning is real.
- **Compose a room before its members arrive** — the administrator picks
  participants from the directory, and the room is born closed.
- **Enforceable licence**: notice as expiry approaches, then **30 days**
  of grace, then read-only. History always remains readable. Device seats
  are released when a machine is replaced.

### Notable fixes

- The taskbar icon was replaced by a generic one.
- Windows notifications did not appear at all.
- The database journal was never checkpointed and grew without end.
- The calendar file was written to a temporary folder that Windows wipes.
- Opening the messaging panel is noticeably faster.

### Foundation

**Electron 43** engine, with the corresponding Chromium security fixes.

### Installation

Download the attached installer. **Windows may show a warning**: the
executable is not yet signed with a commercial certificate. If you are
coming from an earlier 0.7.x, uninstall it first.

Permanent server licence: **+213 558 303 030** · **contact@hnaya.dz**

---

<div dir="rtl" align="right">

## العربية

### مراسلة داخلية لا تخرج من أسواركم

يحوّل هذا الإصدار وحدة المراسلة المحلية إلى أداة عمل كاملة: ما كان محادثة
فريق يصبح مسار قرار. كل شيء يبقى على شبكتكم — لا خادم بعيد، ولا حساب، ولا
اشتراك.

**أن تقرّر، لا أن تتحدّث فقط**

- **طلبات موصوفة** — تحمل الرسالة وسمًا (للعلم، رأي، تصديق، موافقة) ويمكن
  أن تحدّد **مُخاطبًا واحدًا بعينه**. ويبقى القرار — مُصدَّق، مرفوض،
  ملاحظات — مرتبطًا بالطلب، مع صاحبه وتوقيته، **موقَّعًا تشفيريًّا**. لا
  التباس بعد اليوم في مَن صدّق على ماذا. ويمكن أن يصحب الطلبَ مرفق:
  التصديق على «التقرير» يعني التصديق على ذلك الملف بعينه.
- **تصويت** — بالاسم أو بغيره، يُحسب بالأشخاص لا بالأجهزة.
- **اجتماعات** — تُعلَن في الغرفة، وتُثبَّت مع عدّها التنازلي، ويُنبَّه
  إليها بإشعار Windows **قبل خمس عشرة دقيقة** حتى والمتصفّح مغلق، وتُصدَّر
  إلى Outlook أو Thunderbird (ملف `.ics` في `Documents\Hnaya\Agenda`).
  ويمكن **تأجيل** الاجتماع أو **إلغاؤه**: يظهر الموعد الجديد، ويبقى القديم
  مشطوبًا، ويُعرف مَن قرّر التغيير.

**أن تعرف مَن تخاطب**

- **دليل** الغرفة: مَن حاضر، ووظيفته في المؤسسة، وحالة اتصاله. نقرة واحدة
  تفتح محادثة خاصة.
- **صور الملف الشخصي** — أو أحرف أولى ملوّنة عند غيابها، ثابتة ومميّزة.
  وهي ترافق الآن كل مداخلة في المحادثة.
- **إشعارات القراءة** لكل شخص، وتحت رسائلك أنت فقط.
- **اسم واحد لجهازيك**: يرتبط هاتفك بحاسوبك، فلا تُحسب إلا صوتًا واحدًا في
  التصويت.
- **اسم الغرفة مُثبَت** حيث تكتب — في شريط، وفي حقل الكتابة نفسه. الخطأ في
  الغرفة يعني إرسال وثيقة إلى الإدارة الخطأ.

**أن ترسل غير النصّ**

صور، ووثائق (PDF وWord وExcel…)، و**رسائل صوتية**، حتى 25 ميبي بايت.
ويمكنك **الاستماع إلى نفسك قبل الإرسال**. ويمكنك **إرسال ملف إلى نفسك**،
من حاسوبك إلى هاتفك.

**من الهاتف، دون تثبيت أي شيء**

صفحة ويب تُقدَّم على شبكتكم الداخلية: لا تطبيق ولا متجر تطبيقات. أُعيد
تصميمها لتناسب الشاشات الضيّقة، وهي تنبّهك إن كان خيار «موقع سطح المكتب»
في متصفّحك يجعلها غير مقروءة.

### الخادم الدائم — خدمة بترخيص

- **غرف متعدّدة خلف عنوان واحد**: الغرفة العامة، الإدارة، الموارد
  البشرية… خدمة واحدة تُثبَّت، وقاعدة واحدة تُحفَظ، ودليل مشترك. وتحتفظ كل
  غرفة برمز دخولها الخاص، وهو أيضًا مفتاح تشفيرها: الفصل حقيقي.
- **تكوين غرفة قبل وصول أعضائها** — يختار المسؤول المشاركين من الدليل،
  فتُنشأ الغرفة مغلقة.
- **ترخيص نافذ**: إشعار مع اقتراب الأجل، ثم **ثلاثون يومًا** من المهلة، ثم
  القراءة فقط. ويبقى السجل قابلًا للمطالعة دائمًا. وتُحرَّر حصص الأجهزة
  عند استبدال حاسوب.

### إصلاحات جديرة بالذكر

- كانت أيقونة شريط المهام تُستبدل بأيقونة عامة.
- لم تكن إشعارات Windows تظهر إطلاقًا.
- لم يكن سجل قاعدة البيانات يُدمَج، فكان ينمو بلا حدّ.
- كان ملف التقويم يُكتب في مجلد مؤقّت يمحوه Windows.
- فتح المراسلة أصبح أسرع بشكل ملموس.

### الأساس

محرّك **Electron 43**، مع ما يقابله من إصلاحات أمن Chromium.

### التثبيت

نزّلوا المُثبِّت المرفق. **قد يُظهر Windows تحذيرًا**: المُنفَّذ ليس موقَّعًا
بشهادة تجارية بعد. وإن كنتم قادمين من إصدار 0.7.x سابق، فأزيلوه أوّلًا.

ترخيص الخادم الدائم: **+213 558 303 030** · **contact@hnaya.dz**

</div>
