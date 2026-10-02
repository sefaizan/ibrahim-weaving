/* Urdu (اردو) display language. Loaded after autobackup.js and just before lock-init.js (which must stay last).
 *
 * WHAT IT DOES: a small button in the header ("اردو" / "English") switches the screen text between English and
 * Urdu on THIS phone only. It is a display layer: after the app draws a screen, every piece of text that exactly
 * matches an entry in I18N_UR is swapped for its Urdu version; switching back puts the English text back.
 *
 * WHAT IT NEVER TOUCHES: the ledger. Names, qualities, looms, clients, amounts, dates and notes you typed are not
 * in the dictionary, so they stay exactly as entered. This file does not read or write DATA, does not call save(),
 * and the language choice is kept only in this phone's storage (never synced, never in a backup).
 *
 * WHAT IS NOT TRANSLATED (yet): any text not in the dictionary stays English, so a screen can be part Urdu, part
 * English. Text built from changing numbers/names, PDFs, CSV files and the cloud-sync / encryption screens may still be English. To translate more, add the English text exactly as it appears and its Urdu below.
 * Layout stays left-to-right; Urdu text itself reads right-to-left and lines up to the right on its own.
 */
const I18N_KEY = 'khata-lang';                 // 'ur' or 'en', this phone only
const I18N_UR = {
  // Menu groups and pages
  'Daily':'روزانہ', 'Money':'رقم', 'Family':'گھر', 'Materials':'مال', 'Tools':'ٹولز',
  'Overview':'جائزہ', 'Production':'پیداوار', 'Sale':'فروخت', 'Recovery':'وصولی', 'Expense':'اخراجات', 'Wages':'اجرت',
  'Loans (Employee)':'قرض (ملازم)', 'Grey Cloth Rate':'گرے کپڑے کا ریٹ', 'Family Expense':'گھریلو اخراجات',
  'Personal Expense':'ذاتی اخراجات', 'Personal Loans (Given)':'ذاتی قرض (دیے گئے)', 'Owner Loans (to Company)':'مالک کا قرض (کمپنی کو)', 'Warp (Tana)':'تانا',
  'Weft (Bana)':'بانا', 'Warp (Tana) Beam':'تانا بیم', 'Cash Checkpoints':'کیش چیک پوائنٹس', 'Graphs':'گراف',
  'Approvals':'منظوریاں', 'Audit':'آڈٹ', 'Settings':'سیٹنگز', 'Backup & Restore':'بیک اپ اور بحالی',
  // Header
  'View only':'صرف دیکھنے کی اجازت', 'Loading…':'لوڈ ہو رہا ہے…',
  // Production: entry form
  'Log Production':'پیداوار درج کریں', 'Date':'تاریخ', 'Time':'وقت', 'Quality':'کوالٹی', 'Loom':'لوم',
  'Quantity Produced (mtr)':'تیار شدہ مقدار (میٹر)', 'Employees & Their Meters':'ملازمین اور ان کے میٹر',
  'Employee 1':'ملازم 1', 'Employee 1 Meters':'ملازم 1 کے میٹر', 'Employee 2 (optional)':'ملازم 2 (اختیاری)',
  'Employee 2 Meters':'ملازم 2 کے میٹر', 'Employee 3':'ملازم 3', 'Employee 3 Meters':'ملازم 3 کے میٹر',
  '+ Add a third employee':'+ تیسرا ملازم شامل کریں', 'Add & next loom →':'شامل کریں اور اگلا لوم ←',
  'Add Entry':'اندراج شامل کریں', 'Cancel Edit':'ترمیم منسوخ کریں',
  // Production: bulk import and log
  'Bulk Import':'اکٹھا درآمد', 'Import Rows':'قطاریں درآمد کریں', 'Production Log':'پیداوار کا ریکارڈ',
  'Filter by Quality':'کوالٹی کے مطابق فلٹر', 'All Qualities':'تمام کوالٹیز', 'All Time':'تمام وقت',
  'This Month':'اس مہینے', 'Last Month':'پچھلے مہینے', 'This Year':'اس سال', 'Custom…':'اپنی مرضی…',
  'From':'سے', 'To':'تک', 'Qty':'مقدار', 'Beam':'بیم', 'Emp 1':'ملازم 1', 'Emp 2':'ملازم 2', 'Emp 3':'ملازم 3', 'Diff':'فرق',
  // Settings lists
  'General':'عمومی', 'Security & sync':'سیکیورٹی اور سنک', 'People':'افراد', 'Looms & materials':'لومز اور مال',
  'Qualities':'کوالٹیز', 'Looms':'لومز', 'Employees':'ملازمین', 'Name':'نام',
  // Common buttons
  'Edit':'ترمیم', 'Delete':'حذف', 'Cancel':'منسوخ', 'Save':'محفوظ کریں', 'Close':'بند کریں', 'Search':'تلاش',
  'Yes':'ہاں', 'No':'نہیں', 'OK':'ٹھیک ہے', 'Info':'معلومات', 'Undo':'واپس'
};
// More screens: Sale, Recovery, Wages, loans, expenses, receipts, backup, approvals and common pop-up messages.
const I18N_UR_MORE = {
  "Open menu": "مینو کھولیں",
  "Changes waiting for your approval": "آپ کی منظوری کے منتظر تبدیلیاں",
  "Undo recent changes": "حالیہ تبدیلیاں واپس کریں",
  "Ready to share": "شیئر کے لیے تیار",
  "Choose how to send this receipt.": "رسید بھیجنے کا طریقہ چنیں۔",
  "Try sharing again": "دوبارہ شیئر کریں",
  "Share as text instead": "اس کی جگہ ٹیکسٹ کے طور پر شیئر کریں",
  "Download instead": "اس کی جگہ ڈاؤن لوڈ کریں",
  "Back up now": "ابھی بیک اپ لیں",
  "Dismiss": "ہٹائیں",
  "That receipt could not be found.": "وہ رسید نہیں ملی۔",
  "Receipt shared ✓": "رسید شیئر ہو گئی ✓",
  "This receipt is too long for one picture — use Print / Save as PDF instead.": "یہ رسید ایک تصویر کے لیے بہت لمبی ہے — پرنٹ / PDF محفوظ کریں استعمال کریں۔",
  "Could not open share — tap Share again.": "شیئر نہیں کھل سکا — دوبارہ شیئر دبائیں۔",
  "⚠ Backup Reminder": "⚠ بیک اپ کی یاد دہانی",
  "Options & password": "اختیارات اور پاس ورڈ",
  "⚠ Reminders": "⚠ یاد دہانیاں",
  "View Cheques": "چیک دیکھیں",
  "View Clients": "گاہک دیکھیں",
  "⏳ Beams ending soon": "⏳ جلد ختم ہونے والے بیم",
  "View Beams": "بیم دیکھیں",
  "Beam Forecast": "بیم کا اندازہ",
  "Beam Alerts": "بیم الرٹ",
  "Alert me when a beam has": "بیم میں جب یہ باقی ہو تو بتائیں",
  "Period": "مدت",
  "+ Add Sale": "+ فروخت شامل کریں",
  "+ Add Recovery": "+ وصولی شامل کریں",
  "Month": "مہینہ",
  "— Any month —": "— کوئی بھی مہینہ —",
  "Year": "سال",
  "— Any year —": "— کوئی بھی سال —",
  "Or range — From": "یا مدت — سے",
  "A From/To range overrides Month/Year above.": "سے/تک کی مدت اوپر کے مہینے/سال پر غالب رہتی ہے۔",
  "Download PDF": "PDF ڈاؤن لوڈ کریں",
  "Share Statement": "اسٹیٹمنٹ شیئر کریں",
  "Cash Position": "نقد کی صورتحال",
  "At a Glance": "ایک نظر میں",
  "Stock Position": "اسٹاک کی صورتحال",
  "Stock by Quality": "کوالٹی کے مطابق اسٹاک",
  "Overall": "مجموعی",
  "Sales & Receivables": "فروخت اور وصولیاں",
  "Breakdown by Client": "گاہک کے مطابق تفصیل",
  "No warp beams linked to a purchase in the last 2 months.": "پچھلے 2 مہینوں میں کسی خریداری سے جڑا کوئی تانا بیم نہیں۔",
  "In Progress": "جاری",
  "View All Purchases": "تمام خریداریاں دیکھیں",
  "Receivables Aging": "وصولیوں کی عمر",
  "Nothing outstanding right now.": "اس وقت کچھ باقی نہیں۔",
  "Clients Breakdown by Quality": "کوالٹی کے مطابق گاہکوں کی تفصیل",
  "No sales yet": "ابھی کوئی فروخت نہیں",
  "Client": "گاہک",
  "Total": "کل",
  "Expenses & Material Cost": "اخراجات اور مال کی لاگت",
  "Profit / Loss": "نفع / نقصان",
  "Trends Over Time": "وقت کے ساتھ رجحان",
  "From Date": "شروع کی تاریخ",
  "To Date": "آخری تاریخ",
  "Meters produced vs meters sold, per month.": "ماہانہ تیار شدہ میٹر بمقابلہ فروخت شدہ میٹر۔",
  "Cash + Bank Transfer + Cleared cheques counted toward Receivable, per month.": "نقد + بینک ٹرانسفر + کلیئر چیک جو ماہانہ وصولی میں گنے گئے۔",
  "Tap for full figure": "پوری رقم کے لیے دبائیں",
  "— Select a purchase —": "— خریداری چنیں —",
  "⏳ Awaiting": "⏳ منتظر",
  "Returned": "واپس",
  "Amount": "رقم",
  "Receivable": "قابلِ وصول",
  "Log Sale": "فروخت درج کریں",
  "Sales Log": "فروخت کا ریکارڈ",
  "Filter by Client": "گاہک کے مطابق فلٹر",
  "All Clients": "تمام گاہک",
  "Mark Cleared": "کلیئر لکھیں",
  "Mark Bounced": "باؤنس لکھیں",
  "Log replacement": "متبادل درج کریں",
  "Mark Replaced": "تبدیل شدہ لکھیں",
  "Reopen as Pending": "زیرِ التوا کے طور پر دوبارہ کھولیں",
  "No later payment from this client is big enough.": "اس گاہک کی بعد کی کوئی ادائیگی اتنی بڑی نہیں۔",
  "Reopen as Bounced": "باؤنس کے طور پر دوبارہ کھولیں",
  "Return Lot": "لاٹ واپس",
  "Cash": "نقد",
  "Bank": "بینک",
  "Cheque": "چیک",
  "Outstanding": "بقایا",
  "Paid ahead": "پیشگی ادا",
  "Nothing outstanding": "کچھ بقایا نہیں",
  "Bounced": "باؤنس",
  "Received by Client": "گاہک کی طرف سے وصول",
  "Sales": "فروخت",
  "Received": "وصول",
  "No recovery entries yet": "ابھی کوئی وصولی نہیں",
  "Pending Cheques": "زیرِ التوا چیک",
  "Log Payment Received": "وصول شدہ ادائیگی درج کریں",
  "+ Add Cash": "+ نقد شامل کریں",
  "+ Add Cheque": "+ چیک شامل کریں",
  "Recovery Log": "وصولی کا ریکارڈ",
  "Category": "زمرہ",
  "Log Business Expense": "کاروباری خرچ درج کریں",
  "Expense Log": "اخراجات کا ریکارڈ",
  "Log Family Expense": "گھریلو خرچ درج کریں",
  "Family Expense Log": "گھریلو اخراجات کا ریکارڈ",
  "Log Personal Expense": "ذاتی خرچ درج کریں",
  "Personal Expense Log": "ذاتی اخراجات کا ریکارڈ",
  "Enter bags & lbs/bag to auto-calculate total weight.": "کل وزن خودکار نکالنے کے لیے بوریاں اور پاؤنڈ/بوری لکھیں۔",
  "This entry is from": "یہ اندراج اس سے ہے",
  "Active": "فعال",
  "Complete": "مکمل",
  "Overall Summary": "مجموعی خلاصہ",
  "Length Logged": "درج شدہ لمبائی",
  "Shrinkage": "کمی",
  "Yield": "حاصل",
  "Cost / Meter": "لاگت / میٹر",
  "Beam-Level Detail": "بیم کی تفصیل",
  "No purchases currently in progress.": "اس وقت کوئی خریداری جاری نہیں۔",
  "Select Purchase": "خریداری چنیں",
  "No completed purchases yet.": "ابھی کوئی خریداری مکمل نہیں۔",
  "Log Beam": "بیم درج کریں",
  "Filter by Source Purchase": "خریداری کے مطابق فلٹر",
  "— All purchases —": "— تمام خریداریاں —",
  "Finished": "مکمل شدہ",
  "Reopen": "دوبارہ کھولیں",
  "Mark Finished": "مکمل لکھیں",
  "Finished Beams Log": "مکمل بیم کا ریکارڈ",
  "Whole": "پورا",
  "Remove": "ہٹائیں",
  "Effective From": "نافذ العمل از",
  "Set Opening Balances": "ابتدائی بیلنس طے کریں",
  "Employee": "ملازم",
  "Save Opening Balances": "ابتدائی بیلنس محفوظ کریں",
  "Settle All Employees": "تمام ملازمین کا حساب کریں",
  "Current Balance": "موجودہ بیلنس",
  "Quality Rates": "کوالٹی کے ریٹ",
  "Effective": "نافذ",
  "Add qualities in the settings tab first": "پہلے سیٹنگز میں کوالٹیز شامل کریں",
  "Rate History": "ریٹ کی تاریخ",
  "Save New Rate": "نیا ریٹ محفوظ کریں",
  "Wage Payments Log": "اجرت کی ادائیگیوں کا ریکارڈ",
  "Add Payment": "ادائیگی شامل کریں",
  "Bonus Log": "بونس کا ریکارڈ",
  "Add Bonus": "بونس شامل کریں",
  "Settlements Log": "حساب کتاب کا ریکارڈ",
  "Mark Settled": "حساب مکمل لکھیں",
  "Loans Outstanding": "بقایا قرض",
  "Loan Outstanding": "بقایا قرض",
  "outstanding": "بقایا",
  "overpaid back": "زائد واپس",
  "Total Given": "کل دیا گیا",
  "Total Repaid": "کل واپس",
  "Balance": "بیلنس",
  "No employees yet": "ابھی کوئی ملازم نہیں",
  "Log Loan Payment": "قرض کی ادائیگی درج کریں",
  "Type": "قسم",
  "Loan Given": "قرض دیا",
  "Loan Repaid": "قرض واپس",
  "Add Loan Entry": "قرض کا اندراج شامل کریں",
  "Loan Payments Log": "قرض کی ادائیگیوں کا ریکارڈ",
  "No loans logged yet": "ابھی کوئی قرض درج نہیں",
  "No one added yet — add people to lend to in Settings → Family Members first.": "ابھی کوئی شامل نہیں — پہلے سیٹنگز ← گھر کے افراد میں لوگ شامل کریں۔",
  "Owed to You Now": "اس وقت آپ کو واجب",
  "Total Put In": "کل لگایا گیا",
  "Total Paid Back": "کل واپس ادا",
  "Put in for": "لگایا برائے",
  "Log Owner Loan": "مالک کا قرض درج کریں",
  "Loan In — you put money in": "قرض اندر — آپ نے رقم لگائی",
  "Loan Repaid — paid back to you": "قرض واپس — آپ کو لوٹایا گیا",
  "Add Owner Loan Entry": "مالک کے قرض کا اندراج شامل کریں",
  "Owner Loan Log": "مالک کے قرض کا ریکارڈ",
  "Grey Cloth Rate Calculator": "گرے کپڑے کے ریٹ کا کیلکولیٹر",
  "Additions": "اضافے",
  "Saved Rate Calculations": "محفوظ شدہ ریٹ حساب",
  "Result": "نتیجہ",
  "Total Threads": "کل دھاگے",
  "Picks Addition": "پک کا اضافہ",
  "Extra Addition": "اضافی رقم",
  "Final Rate per Meter": "حتمی ریٹ فی میٹر",
  "Save This Calculation": "یہ حساب محفوظ کریں",
  "Opening Balance": "ابتدائی بیلنس",
  "Log a Cash Checkpoint": "کیش چیک پوائنٹ درج کریں",
  "Add Checkpoint": "چیک پوائنٹ شامل کریں",
  "Checkpoint Log": "چیک پوائنٹ کا ریکارڈ",
  "No entries yet — add one above": "ابھی کوئی اندراج نہیں — اوپر شامل کریں",
  "‹ Prev": "‹ پچھلا",
  "Next ›": "اگلا ›",
  "Receipt": "رسید",
  "Share": "شیئر",
  "OK — no shortage": "ٹھیک ہے — کوئی کمی نہیں",
  "Previous Balance": "پچھلا بیلنس",
  "Current Sale": "موجودہ فروخت",
  "Sale Receipt": "فروخت کی رسید",
  "Invoice No": "انوائس نمبر",
  "Dyeing": "رنگائی",
  "Description": "تفصیل",
  "Thank you for your business.": "آپ کے کاروبار کا شکریہ۔",
  "Amount Credited": "جمع شدہ رقم",
  "Payment Receipt": "ادائیگی کی رسید",
  "Method": "طریقہ",
  "Details": "تفصیلات",
  "Total Received": "کل وصول",
  "Note": "نوٹ",
  "Thank you for your payment.": "آپ کی ادائیگی کا شکریہ۔",
  "Total Sales in Period": "مدت میں کل فروخت",
  "Total Payments in Period": "مدت میں کل ادائیگیاں",
  "Closing Balance": "اختتامی بیلنس",
  "Client Statement": "گاہک کی اسٹیٹمنٹ",
  "Debit": "ڈیبٹ",
  "Credit": "کریڈٹ",
  "Search this list…": "اس فہرست میں تلاش…",
  "Who added or edited this": "یہ کس نے شامل یا ترمیم کیا",
  "Print receipt": "رسید پرنٹ کریں",
  "Share receipt": "رسید شیئر کریں",
  "Move up": "اوپر لے جائیں",
  "Move down": "نیچے لے جائیں",
  "That sale entry could not be found — try refreshing the page.": "وہ فروخت کا اندراج نہیں ملا — صفحہ ریفریش کریں۔",
  "That payment entry could not be found — try refreshing the page.": "وہ ادائیگی کا اندراج نہیں ملا — صفحہ ریفریش کریں۔",
  "What you typed is sealed and cannot be shown until this phone is unlocked.": "جو آپ نے لکھا وہ بند ہے اور فون کھلنے تک نہیں دکھایا جا سکتا۔",
  "Withdraw": "واپس لیں",
  "Clear": "صاف کریں",
  "Your changes": "آپ کی تبدیلیاں",
  "Only the owner can open approvals.": "صرف مالک منظوریاں کھول سکتا ہے۔",
  "Refresh": "ریفریش",
  "No field differences to show.": "دکھانے کے لیے کوئی فرق نہیں۔",
  "Value": "قدر",
  "Save my version and accept": "میرا ورژن محفوظ کریں اور قبول کریں",
  "Nothing is waiting for your approval.": "آپ کی منظوری کا کچھ منتظر نہیں۔",
  "Ibrahim Weaving": "ابراہیم ویونگ",
  "Power Loom Ledger": "پاور لوم کھاتہ",
  "Inactive": "غیر فعال",
  "No entries yet": "ابھی کوئی اندراج نہیں",
  "Appearance": "ظاہری شکل",
  "Business Info": "کاروباری معلومات",
  "Stock": "اسٹاک",
  "mtr": "میٹر",
  "No stock available.": "کوئی اسٹاک موجود نہیں۔",
  "PIN Lock": "پن لاک",
  "PIN length": "پن کی لمبائی",
  "4 digits": "4 ہندسے",
  "8 digits": "8 ہندسے",
  "Recovery question — asked if you ever forget the PIN.": "بحالی کا سوال — پن بھول جائیں تو پوچھا جائے گا۔",
  "Enable PIN Lock": "پن لاک چالو کریں",
  "No recovery question yet": "ابھی بحالی کا کوئی سوال نہیں",
  "Lock now": "ابھی لاک کریں",
  "Change PIN": "پن تبدیل کریں",
  "Disable PIN Lock": "پن لاک بند کریں",
  "Save New PIN": "نیا پن محفوظ کریں",
  "Save Recovery Question": "بحالی کا سوال محفوظ کریں",
  "Confirm Disable": "بند کرنے کی تصدیق",
  "Loom Assignments": "لوم کی تفویض",
  "Add some Looms above first.": "پہلے اوپر کچھ لوم شامل کریں۔",
  "Quick Assign": "فوری تفویض",
  "Assign to Selected Looms": "منتخب لومز کو تفویض کریں",
  "Per-Loom": "ہر لوم",
  "Employee 2": "ملازم 2",
  "⚠ Your last change was NOT saved.": "⚠ آپ کی آخری تبدیلی محفوظ نہیں ہوئی۔",
  "Open Backup": "بیک اپ کھولیں",
  "Hide": "چھپائیں",
  "Share CSV": "CSV شیئر کریں",
  "App updated to the latest version.": "ایپ تازہ ترین ورژن پر اپ ڈیٹ ہو گئی۔",
  "Recent changes": "حالیہ تبدیلیاں",
  "Nothing to undo yet — edits and removals show up here.": "ابھی واپس کرنے کو کچھ نہیں — ترمیم اور حذف یہاں نظر آئیں گے۔",
  "Backup & Restore": "بیک اپ اور بحالی",
  "Copy Compressed": "کمپریسڈ کاپی کریں",
  "Copy Plain JSON": "سادہ JSON کاپی کریں",
  "Download Compressed JSON": "کمپریسڈ JSON ڈاؤن لوڈ کریں",
  "Download Plain JSON": "سادہ JSON ڈاؤن لوڈ کریں",
  "Restore from a backup": "بیک اپ سے بحال کریں",
  "Choose a backup file": "بیک اپ فائل چنیں",
  "This backup is password-protected — enter its password": "یہ بیک اپ پاس ورڈ سے محفوظ ہے — پاس ورڈ لکھیں",
  "Restore from Backup": "بیک اپ سے بحال کریں",
  "Safety copies on this phone": "اس فون پر حفاظتی کاپیاں",
  "Take a safety copy now": "ابھی حفاظتی کاپی لیں",
  "A question only you can answer": "ایسا سوال جس کا جواب صرف آپ جانتے ہوں",
  "Paste a previously copied/downloaded JSON backup here, or choose a file above": "پہلے سے کاپی/ڈاؤن لوڈ کیا ہوا JSON بیک اپ یہاں پیسٹ کریں، یا اوپر فائل چنیں",
  "The ledger is getting large for this phone's storage — take a backup and plan a storage upgrade.": "کھاتہ اس فون کی میموری کے لیے بڑا ہو رہا ہے — بیک اپ لیں اور میموری بڑھانے کا سوچیں۔",
  "Could not build the export — try again.": "ایکسپورٹ نہیں بن سکا — دوبارہ کوشش کریں۔",
  "CSV saved to Downloads ✓": "CSV ڈاؤن لوڈز میں محفوظ ہو گئی ✓",
  "Download was blocked here.": "یہاں ڈاؤن لوڈ روک دیا گیا۔",
  "Could not open share — use Export CSV instead.": "شیئر نہیں کھل سکا — اس کی جگہ CSV ایکسپورٹ استعمال کریں۔",
  "Could not undo that — the entry was changed or removed again since.": "واپس نہیں ہو سکا — اندراج بعد میں دوبارہ بدلا یا ہٹایا گیا۔",
  "Today": "آج",
  "Yesterday": "کل",
  "ℹ︎ Notes": "ℹ︎ نوٹس",
  "Search this log…": "اس ریکارڈ میں تلاش…",
  "Search this log": "اس ریکارڈ میں تلاش",
  "Custom": "اپنی مرضی",
  "Payments": "ادائیگیاں",
  "Bonus": "بونس",
  "Settled": "حساب مکمل",
  "Rate": "ریٹ",
  "Wages Rs": "اجرت روپے",
  "No production in this period.": "اس مدت میں کوئی پیداوار نہیں۔",
  "Pay": "ادا کریں",
  "Meters": "میٹر",
  "Earned": "کمائی",
  "Paid": "ادا شدہ",
  "Net": "خالص",
  "Total with bonus": "بونس سمیت کل",
  "Carried forward": "آگے منتقل",
  "Last settled": "آخری حساب",
  "Add employees and qualities in the settings tab to see wages.": "اجرت دیکھنے کے لیے سیٹنگز میں ملازمین اور کوالٹیز شامل کریں۔",
  "Total production": "کل پیداوار",
  "This period by quality": "اس مدت کی کوالٹی کے مطابق",
  "Total Meters": "کل میٹر",
  "Total Wages": "کل اجرت",
  "Add wage entry": "اجرت کا اندراج شامل کریں",
  "Set a Date first.": "پہلے تاریخ طے کریں۔",
  "Pick a Quality first.": "پہلے کوالٹی چنیں۔",
  "Paste at least one row first.": "پہلے کم از کم ایک قطار پیسٹ کریں۔",
  "Status": "حالت",
  "Pending": "زیرِ التوا",
  "Cleared": "کلیئر",
  "Replaced": "تبدیل شدہ",
  "✕ Remove Cheque": "✕ چیک ہٹائیں",
  "Safety copies aren't available in this browser.": "اس براؤزر میں حفاظتی کاپیاں دستیاب نہیں۔",
  "None yet — one is taken automatically about once a day.": "ابھی کوئی نہیں — تقریباً دن میں ایک بار خود بخود لی جاتی ہے۔",
  "Restore": "بحال کریں",
  "if different from the client": "اگر گاہک سے مختلف ہو",
  "Remove this cheque": "یہ چیک ہٹائیں",
  "Backup restored ✓": "بیک اپ بحال ہو گیا ✓",
  "Restored from safety copy ✓": "حفاظتی کاپی سے بحال ہو گیا ✓",
  "Refresh ": "ریفریش",
  "Awaiting L (AIL)": "انتظار میں L (AIL)",
  "Open menu ": "مینو کھولیں"
};
for(const k in I18N_UR_MORE){ if(!Object.prototype.hasOwnProperty.call(I18N_UR, k)) I18N_UR[k] = I18N_UR_MORE[k]; }
// Text that starts with one of these (and then carries a number or name) keeps its tail as it is.
const I18N_UR_PREFIX = [ ['Remaining to assign:', 'باقی تقسیم کرنا ہے:'], ['Total stock:', 'کل اسٹاک:'], ['Note to', 'نوٹ برائے'], ['Note:', 'نوٹ:'], ['Current question:', 'موجودہ سوال:'], ["Owner\u2019s note:", 'مالک کا نوٹ:'] ];
const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];
let I18N_LANG = 'en';
let I18N_TIMER = 0;
let I18N_OBS = null;
const I18N_NODES = (typeof WeakMap !== 'undefined') ? new WeakMap() : null; // text node -> {en, ur}

// The Urdu for one piece of text (already trimmed), or null when it is not in the dictionary.
function i18nTranslate(s){
  if(Object.prototype.hasOwnProperty.call(I18N_UR, s)) return I18N_UR[s];
  for(const [p, u] of I18N_UR_PREFIX){ if(s.startsWith(p)) return u + s.slice(p.length); }
  return null;
}
function i18nSkipNode(el){
  if(!el) return true;
  if(/^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT)$/.test(el.tagName)) return true;
  return !!(el.closest && el.closest('[data-no-i18n],[contenteditable="true"]'));
}
function i18nTextNode(n){
  const cur = n.nodeValue;
  const rec = I18N_NODES.get(n);
  if(rec && cur === rec.ur) return;                  // already Urdu
  const core = cur.replace(/\s+/g, ' ').trim();
  if(!core) return;
  const ur = i18nTranslate(core);
  if(ur === null) return;
  const out = cur.match(/^\s*/)[0] + ur + cur.match(/\s*$/)[0];
  I18N_NODES.set(n, { en: cur, ur: out });
  n.nodeValue = out;
}
function i18nAttrsOf(el){
  I18N_ATTRS.forEach(a=>{
    const v = el.getAttribute(a);
    if(!v || el.getAttribute('data-ur-' + a) === v) return;
    const ur = i18nTranslate(v.trim());
    if(ur === null) return;
    el.setAttribute('data-en-' + a, v);
    el.setAttribute('data-ur-' + a, ur);
    el.setAttribute(a, ur);
  });
}
function i18nWalk(root){
  const w = document.createTreeWalker(root, 1 | 4, null);   // elements and text
  let n;
  while((n = w.nextNode())){
    if(n.nodeType === 3){ if(!i18nSkipNode(n.parentElement)) i18nTextNode(n); }
    else if(!/^(SCRIPT|STYLE)$/.test(n.tagName)) i18nAttrsOf(n);
  }
}
function i18nRestore(root){
  const w = document.createTreeWalker(root, 1 | 4, null);
  let n;
  while((n = w.nextNode())){
    if(n.nodeType === 3){
      const rec = I18N_NODES.get(n);
      if(rec && n.nodeValue === rec.ur) n.nodeValue = rec.en;
    } else {
      I18N_ATTRS.forEach(a=>{
        const ur = n.getAttribute('data-ur-' + a);
        if(ur === null) return;
        if(n.getAttribute(a) === ur) n.setAttribute(a, n.getAttribute('data-en-' + a));
        n.removeAttribute('data-ur-' + a); n.removeAttribute('data-en-' + a);
      });
    }
  }
}
function i18nObserve(){
  if(!I18N_OBS) I18N_OBS = new MutationObserver(i18nSchedule);
  I18N_OBS.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}
function i18nRun(){
  if(!document.body) return;
  if(I18N_OBS) I18N_OBS.disconnect();               // our own changes must not wake the observer
  try{ i18nWalk(document.body); }catch(e){ console.error(e); }
  i18nObserve();
}
function i18nSchedule(){
  if(I18N_LANG !== 'ur' || I18N_TIMER) return;
  I18N_TIMER = setTimeout(()=>{ I18N_TIMER = 0; i18nRun(); }, 30);
}
function i18nButtonLabel(){
  const b = document.getElementById('langBtn');
  if(b) b.textContent = I18N_LANG === 'ur' ? 'English' : 'اردو';
}
function i18nSetLang(l){
  I18N_LANG = (l === 'ur') ? 'ur' : 'en';
  try{ localStorage.setItem(I18N_KEY, I18N_LANG); }catch(e){ /* the choice just will not be remembered */ }
  document.documentElement.setAttribute('lang', I18N_LANG);
  i18nButtonLabel();
  if(I18N_LANG === 'ur') i18nRun();
  else {
    if(I18N_OBS) I18N_OBS.disconnect();
    try{ i18nRestore(document.body); }catch(e){ console.error(e); }
  }
}
function i18nInit(){
  const css = document.createElement('style');
  css.textContent =
    'html[lang="ur"] body,html[lang="ur"] button,html[lang="ur"] input,html[lang="ur"] select,html[lang="ur"] textarea{font-family:"Noto Naskh Arabic","Geeza Pro","Segoe UI",Tahoma,sans-serif}' +
    'html[lang="ur"] label,html[lang="ur"] h1,html[lang="ur"] h2,html[lang="ur"] h3,html[lang="ur"] p,html[lang="ur"] th,html[lang="ur"] .note,html[lang="ur"] .group-label,html[lang="ur"] .sub{unicode-bidi:plaintext}' +
    '#langBtn{position:relative;font-size:14px;font-weight:700;line-height:18px;min-height:0;height:auto;padding:2px 14px;margin:0;border-radius:20px;pointer-events:auto}' +
    '#langBtn::after{content:"";position:absolute;inset:-10px -8px}' +
    'html[lang=\"ur\"] label,html[lang=\"ur\"] p,html[lang=\"ur\"] th,html[lang=\"ur\"] td,html[lang=\"ur\"] .note,html[lang=\"ur\"] .legend,html[lang=\"ur\"] .chip,html[lang=\"ur\"] .stat .label,html[lang=\"ur\"] .ov-kpi .label{font-size:1.12em;line-height:1.9}' +
    'html[lang=\"ur\"] h2,html[lang=\"ur\"] h3{line-height:1.7}' +
    'html[lang=\"ur\"] input,html[lang=\"ur\"] select,html[lang=\"ur\"] textarea{font-size:1.08em;line-height:1.6}';
  document.head.appendChild(css);
  const meta = document.querySelector('.appbar-meta');
  if(meta){
    const b = document.createElement('button');
    b.id = 'langBtn'; b.type = 'button'; b.className = 'ghost'; b.setAttribute('data-no-i18n', '');
    b.setAttribute('aria-label', 'Language');
    b.addEventListener('click', ()=> i18nSetLang(I18N_LANG === 'ur' ? 'en' : 'ur'));
    meta.insertBefore(b, meta.firstChild);
  }
  let saved = 'en';
  try{ saved = localStorage.getItem(I18N_KEY) === 'ur' ? 'ur' : 'en'; }catch(e){ /* default English */ }
  i18nSetLang(saved);
}
if(typeof document !== 'undefined' && document.body){ i18nInit(); }
