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
  'Loans (Employee)':'قرض (ملازم)', 'Grey Cloth Rate':'کورے کپڑے کا ریٹ', 'Cost & Margin':'لاگت اور منافع', 'Orders':'آرڈرز', 'Family Expense':'گھریلو اخراجات',
  'Personal Expense':'ذاتی اخراجات', 'Personal Loans (Given)':'ذاتی قرض (دیے گئے)', 'Owner Loans (to Company)':'مالک کا قرض (کمپنی کو)', 'Warp (Tana)':'تانا',
  'Weft (Bana)':'بانا', 'Warp (Tana) Beam':'تانا بیم', 'Cash Checkpoints':'کیش چیک پوائنٹس', 'Graphs':'گراف', 'Year Report':'سالانہ رپورٹ', 'Quarterly Stock Valuation':'اسٹاک کی قدر', 'Add valuation':'قدر شامل کریں', 'Save opening position':'ابتدائی پوزیشن محفوظ کریں', 'Full period':'پوری مدت', 'Profit before drawings':'نکالی گئی رقم سے پہلے منافع', 'Profit after drawings':'نکالی گئی رقم کے بعد منافع', 'Closing capital':'اختتامی سرمایہ', 'Opening capital':'ابتدائی سرمایہ',
  'Approvals':'منظوریاں', 'Audit':'آڈٹ', 'Settings':'سیٹنگز', 'Backup & Restore':'بیک اپ اور بحالی',
  // Header
  'View only':'صرف دیکھنے کی اجازت', 'Loading…':'لوڈ ہو رہا ہے…',
  // Graphs page (v3.18.0)
  'See full chart ↓':'مکمل چارٹ دیکھیں ↓', 'Month by month':'مہینہ بہ مہینہ',
  'This Quarter':'اس سہ ماہی', 
  'Live':'لائیو', '◐ Compare with previous period':'◐ پچھلی مدت سے موازنہ', 'Tap a bar for details':'تفصیل کے لیے بار پر ٹیپ کریں',
  'Cash Received':'وصول شدہ رقم',
  'vs prev period':'پچھلی مدت کے مقابلے', 'Highlights':'نمایاں باتیں', 'Best month':'بہترین مہینہ', 'Weakest month':'کمزور ترین مہینہ',
  'Average monthly sales':'ماہانہ اوسط فروخت', 'Average monthly profit':'ماہانہ اوسط منافع', 'Months in profit':'منافع والے مہینے',
  'Production by Quality':'کوالٹی کے مطابق پیداوار', 'Weekly Production (Last 12 Weeks)':'ہفتہ وار پیداوار (پچھلے 12 ہفتے)',
  'Receivable Trend (Rs)':'وصولی طلب رجحان (روپے)', 'Collection Rate (%)':'وصولی کی شرح (%)', 'Average Selling Rate (Rs / m)':'اوسط فروخت ریٹ (روپے / میٹر)',
  'Top Clients':'سرفہرست گاہک', 'Where the Money Went':'پیسہ کہاں گیا', 'so far':'اب تک',
  'Business':'کاروبار', 'Personal':'ذاتی', 
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
  "Grey Cloth Rate Calculator": "کورے کپڑے کے ریٹ کا کیلکولیٹر",
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
// Added v3.17.55: second pass over every page (audit, cloud sync, encryption, roles, receipts, purchases, loans, backup).
const I18N_UR_EXTRA = {"Ibrahim Weaving — Power Loom Ledger":"ابراہیم ویونگ — پاور لوم کھاتہ",
"Audit trail":"آڈٹ ٹریل",
"Open Audit screen":"آڈٹ اسکرین کھولیں",
"Only the owner can open the audit trail.":"صرف مالک آڈٹ ٹریل کھول سکتا ہے۔",
"All sections":"تمام سیکشنز",
"All actions":"تمام کارروائیاں",
"From date":"از تاریخ",
"To date":"تا تاریخ",
"Person":"شخص",
"Everyone":"سب",
"Section":"سیکشن",
"Action":"کارروائی",
"Load":"لوڈ کریں",
"Clear filters":"فلٹر صاف کریں",
"Load older":"پرانا لوڈ کریں",
"Field":"خانہ",
"Before":"پہلے",
"After":"بعد",
"No field differences.":"خانوں میں کوئی فرق نہیں۔",
"Audit log could not be saved on this phone - free up storage":"آڈٹ لاگ اس فون میں محفوظ نہیں ہو سکا - اسٹوریج خالی کریں",
"Automatic email backup":"خودکار ای میل بیک اپ",
"Email me a backup automatically":"مجھے بیک اپ خود بخود ای میل کریں",
"Backup time (every day)":"بیک اپ کا وقت (روزانہ)",
"Backup service address":"بیک اپ سروس کا پتہ",
"Backup key":"بیک اپ کی",
"Password for the emailed file":"ای میل شدہ فائل کا پاس ورڈ",
"Remove the password (emailed files will not be protected)":"پاس ورڈ ہٹائیں (ای میل شدہ فائلیں محفوظ نہیں ہوں گی)",
"Save & send a test backup":"محفوظ کریں اور ٹیسٹ بیک اپ بھیجیں",
"Send a backup now":"ابھی بیک اپ بھیجیں",
"No one is approved yet.":"ابھی کسی کو منظور نہیں کیا گیا۔",
"Choose a role":"کردار چنیں",
"Sections":"سیکشنز",
"Extend":"بڑھائیں",
"Shorten":"کم کریں",
"Access code":"رسائی کوڈ",
"Revoke":"منسوخ کریں",
"V view, A add, E edit, D delete. Add / edit / delete only work while their edit switch is on.":"V دیکھنا، A شامل کرنا، E ترمیم، D حذف۔ شامل / ترمیم / حذف صرف تب چلتے ہیں جب ان کا ایڈٹ سوئچ آن ہو۔",
"Needs my approval":"میری منظوری درکار",
"Save access":"رسائی محفوظ کریں",
"Reset to role":"کردار پر واپس",
"minutes":"منٹ",
"hours":"گھنٹے",
"days":"دن",
"Apply":"لاگو کریں",
"Save role":"کردار محفوظ کریں",
"New role":"نیا کردار",
"Create role":"کردار بنائیں",
"Roles":"کردار",
"Approved for":"منظور شدہ برائے",
"until a date and time":"تاریخ اور وقت تک",
"Role":"کردار",
"Approve to view":"دیکھنے کی منظوری",
"Approve to edit":"ترمیم کی منظوری",
"We emailed a verification link to this address. Open it, then tap below.":"ہم نے اس پتے پر تصدیقی لنک بھیجا ہے۔ اسے کھولیں، پھر نیچے ٹیپ کریں۔",
"I've verified — continue":"میں نے تصدیق کر لی — آگے بڑھیں",
"Resend verification email":"تصدیقی ای میل دوبارہ بھیجیں",
"Owner account.":"مالک کا اکاؤنٹ۔",
"— this phone shows the ledger and keeps it up to date from the cloud, but can’t change it.":"— یہ فون کھاتہ دکھاتا ہے اور کلاؤڈ سے اپ ڈیٹ رکھتا ہے، مگر اسے تبدیل نہیں کر سکتا۔",
"Sign out":"سائن آؤٹ",
"Create an account":"اکاؤنٹ بنائیں",
"Create account":"اکاؤنٹ بنائیں",
"I already have an account":"میرا اکاؤنٹ پہلے سے ہے",
"Reset password":"پاس ورڈ ری سیٹ کریں",
"Email me a reset link":"مجھے ری سیٹ لنک ای میل کریں",
"Back to sign in":"سائن اِن پر واپس",
"Sign in to sync":"سنک کے لیے سائن اِن کریں",
"Sign in":"سائن اِن",
"Forgot password?":"پاس ورڈ بھول گئے؟",
"Cloud Sync":"کلاؤڈ سنک",
"Email/Password":"ای میل/پاس ورڈ",
"Enable Cloud Sync":"کلاؤڈ سنک چالو کریں",
"Sync Now":"ابھی سنک کریں",
"This device and another device both have changes the other hasn't seen. Pick which copy to keep — the other will be overwritten:":"اس ڈیوائس اور دوسری ڈیوائس دونوں میں ایسی تبدیلیاں ہیں جو دوسری نے نہیں دیکھیں۔ چنیں کون سی کاپی رکھنی ہے — دوسری مٹ جائے گی:",
"Keep This Device's Data":"اس ڈیوائس کا ڈیٹا رکھیں",
"Use Cloud's Data Instead":"اس کے بجائے کلاؤڈ کا ڈیٹا استعمال کریں",
"Advanced: use another device's encryption key":"ایڈوانسڈ: دوسری ڈیوائس کی انکرپشن کی استعمال کریں",
"Join Encrypted Sync":"انکرپٹڈ سنک میں شامل ہوں",
"How much":"کتنا",
"Unit":"اکائی",
"Role name":"کردار کا نام",
"Their email":"ان کی ای میل",
"Later":"بعد میں",
"Email":"ای میل",
"Repeat password":"پاس ورڈ دوبارہ لکھیں",
"Password":"پاس ورڈ",
"PIN used on the OTHER device":"دوسری ڈیوائس پر استعمال ہونے والا پن",
"This device":"یہ ڈیوائس",
"Signed in as":"سائن اِن بطور",
"Add this device in":"اس ڈیوائس کو شامل کریں",
"Encrypt Data":"ڈیٹا انکرپٹ کریں",
"Turn on PIN Lock above first — the PIN is what unlocks the encryption.":"پہلے اوپر پن لاک آن کریں — انکرپشن پن سے کھلتی ہے۔",
"Set a recovery question in PIN Lock above first, so a forgotten PIN can never lock you out of your own data.":"پہلے اوپر پن لاک میں ریکوری سوال طے کریں، تاکہ پن بھولنے سے آپ اپنے ڈیٹا سے باہر نہ ہو جائیں۔",
"Turn On Encryption…":"انکرپشن آن کریں…",
"The recovery question is:":"ریکوری سوال ہے:",
"A recovery key will be shown once when encryption turns on — print or save it right then.":"انکرپشن آن ہونے پر ریکوری کی ایک بار دکھائی جائے گی — اسی وقت پرنٹ یا محفوظ کر لیں۔",
"Encrypt Now":"ابھی انکرپٹ کریں",
"On.":"آن۔",
"Recovery key:":"ریکوری کی:",
"not created yet.":"ابھی نہیں بنی۔",
"A new key replaces the old one — the old key stops working.":"نئی کی پرانی کی کی جگہ لے لیتی ہے — پرانی کی کام کرنا بند کر دیتی ہے۔",
"Create Key":"کی بنائیں",
"Turn Off Encryption…":"انکرپشن آف کریں…",
"Turn Off Encryption":"انکرپشن آف کریں",
"Your recovery key":"آپ کی ریکوری کی",
"This is the only time it is shown. Print it or save it now and keep it somewhere safe — it opens the app if the PIN is forgotten.":"یہ صرف ایک بار دکھائی جاتی ہے۔ ابھی پرنٹ یا محفوظ کریں اور کسی محفوظ جگہ رکھیں — پن بھول جائیں تو یہ ایپ کھولتی ہے۔",
"Copy":"کاپی",
"Print":"پرنٹ",
"Save as text":"ٹیکسٹ کے طور پر محفوظ کریں",
"I have saved this key":"میں نے یہ کی محفوظ کر لی",
"Done":"مکمل",
"Khata recovery key":"کھاتہ ریکوری کی",
"Keep this page somewhere safe and private. Creating a new key later makes this one stop working.":"اس صفحے کو محفوظ اور نجی جگہ رکھیں۔ بعد میں نئی کی بنانے سے یہ کام کرنا بند کر دے گی۔",
"Recovery key copied":"ریکوری کی کاپی ہو گئی",
"Select the key and copy it manually":"کی کو منتخب کر کے خود کاپی کریں",
"Could not save the file — use Copy or Print instead":"فائل محفوظ نہیں ہو سکی — کاپی یا پرنٹ استعمال کریں",
"Printing did not start — use Save as text instead":"پرنٹ شروع نہیں ہوا — ٹیکسٹ کے طور پر محفوظ کریں",
"Off.":"آف۔",
"The ledger on this phone is encrypted.":"اس فون کا کھاتہ انکرپٹڈ ہے۔",
"Enter PIN":"پن درج کریں",
"Forgot PIN?":"پن بھول گئے؟",
"Recover PIN":"پن بحال کریں",
"Use recovery key instead":"اس کے بجائے ریکوری کی استعمال کریں",
"Back to PIN entry":"پن درج کرنے پر واپس",
"Verify":"تصدیق کریں",
"Recovery Key":"ریکوری کی",
"Type the recovery key you printed or saved when encryption was turned on (dashes and spaces don't matter).":"انکرپشن آن کرتے وقت پرنٹ یا محفوظ کی ہوئی ریکوری کی لکھیں (ڈیش اور خالی جگہ سے فرق نہیں پڑتا)۔",
"Set a New PIN":"نیا پن طے کریں",
"Confirm New PIN":"نئے پن کی تصدیق کریں",
"Your answer":"آپ کا جواب",
"Press back again to exit":"باہر نکلنے کے لیے دوبارہ بیک دبائیں",
"Sending backup…":"بیک اپ بھیجا جا رہا ہے…",
"A payment is still linked as replacing this cheque — edit that payment to remove the link.":"ایک ادائیگی اب بھی اس چیک کی جگہ کے طور پر جڑی ہے — لنک ہٹانے کے لیے اس ادائیگی میں ترمیم کریں۔",
"Linked ✓ — the payment now shows which cheque it replaced.":"جڑ گیا ✓ — ادائیگی اب دکھاتی ہے کہ اس نے کون سا چیک بدلا۔",
"Advance (received ahead)":"ایڈوانس (پیشگی وصول)",
"In Stock by Quality (mtr)":"کوالٹی کے مطابق اسٹاک (میٹر)",
"Warp Usage (Last 2 Months)":"تانے کا استعمال (پچھلے 2 مہینے)",
"90+ Days (overdue)":"90+ دن (واجب الادا)",
"By Client (oldest first)":"گاہک کے مطابق (پرانے پہلے)",
"Quantity (mtr) sold to each client, split by quality.":"ہر گاہک کو فروخت کی گئی مقدار (میٹر)، کوالٹی کے مطابق۔",
"Owner Loans (Owed to You)":"مالک کے قرض (آپ کو واجب)",
"\"Wages\" here is the total of Wage Payments logged (from 29 Aug onwards).":"یہاں \"اجرت\" سے مراد درج کی گئی اجرت کی ادائیگیوں کا کل ہے (29 اگست سے)۔",
"Sales − Business Expenses (incl. Wages Paid) − Family Expenses − Personal Expenses − Warp (Tana) Cost − Weft (Bana) Cost.":"فروخت − کاروباری اخراجات (ادا شدہ اجرت سمیت) − گھریلو اخراجات − ذاتی اخراجات − تانے کی لاگت − بانے کی لاگت۔",
"Production vs Sales (Meters)":"پیداوار بمقابلہ فروخت (میٹر)",
"Profit / Loss (Rs)":"نفع / نقصان (روپے)",
"Sales vs Total Expenses (Rs)":"فروخت بمقابلہ کل اخراجات (روپے)",
"Sales amount vs combined Business + Family + Personal + Warp + Weft cost, per month.":"فروخت کی رقم بمقابلہ کاروبار + گھر + ذاتی + تانا + بانا کی مجموعی لاگت، ماہانہ۔",
"Cash Received (Rs)":"وصول شدہ نقد (روپے)",
"Cash Position uses checkpoint from":"کیش پوزیشن چیک پوائنٹ استعمال کرتی ہے از",
"Rows — one per line: Loom, Qty, Employee1, Meters1[, Employee2, Meters2[, Employee3, Meters3]]":"قطاریں — ہر لائن میں ایک: لوم، مقدار، ملازم1، میٹر1[، ملازم2، میٹر2[، ملازم3، میٹر3]]",
"L (AIL) OK":"L (AIL) ٹھیک",
"Quantity (mtr)":"مقدار (میٹر)",
"Total Sale (All Time)":"کل فروخت (تمام وقت)",
"Amount: —":"رقم: —",
"(overdue)":"(واجب الادا)",
"Apply L (AIL)":"L (AIL) لاگو کریں",
"Received (All Time)":"وصول شدہ (تمام وقت)",
"Cheques (optional — add as many as came with this payment)":"چیک (اختیاری — اس ادائیگی کے ساتھ جتنے آئے شامل کریں)",
"Does part of this payment replace a bounced cheque? (optional)":"کیا اس ادائیگی کا کچھ حصہ باؤنس چیک کی جگہ ہے؟ (اختیاری)",
"Total: Rs 0":"کل: Rs 0",
"Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.":"وقت ایک ہی دن کے اندراجات کو کیش چیک پوائنٹس کے مقابل ترتیب دینے کے لیے ہے — درست ہونا ضروری نہیں۔",
"By Category (All Time)":"قسم کے مطابق (تمام وقت)",
"Log Warp (Tana) Purchase":"تانے کی خریداری درج کریں",
"Weight — by cartons (auto-converts to lbs)":"وزن — کارٹنوں سے (خود بخود پاؤنڈ میں)",
"Enter cartons & kg/carton to auto-calculate weight — or type the lbs directly.":"وزن خود نکالنے کے لیے کارٹن اور کلو/کارٹن لکھیں — یا پاؤنڈ سیدھے لکھیں۔",
"Warp (Tana) Log":"تانے کا ریکارڈ",
"Log Weft (Bana) Purchase":"بانے کی خریداری درج کریں",
"Weight — by bags (auto-calculates total lbs)":"وزن — بوریوں سے (کل پاؤنڈ خود بخود)",
"Total Weight (lbs)":"کل وزن (پاؤنڈ)",
"Weft (Bana) Log":"بانے کا ریکارڈ",
"Log New Warp (Tana) Beam":"نیا تانا بیم درج کریں",
"Warp (Tana) Beam Log":"تانا بیم کا ریکارڈ",
"Reason for the different figure (optional) — e.g. double-L avoided by negotiating extra meters":"مختلف رقم کی وجہ (اختیاری) — مثلاً اضافی میٹر طے کر کے ڈبل-L سے بچاؤ",
"Showing":"دکھایا جا رہا ہے",
"L (AIL) adj.":"L (AIL) ایڈجسٹمنٹ",
"Pending Cheques —":"زیرِ التوا چیک —",
"Bounced Cheques —":"باؤنس چیک —",
"Replaced cheques not linked to a payment —":"تبدیل شدہ چیک جو کسی ادائیگی سے نہیں جڑے —",
"Awaiting L (AIL) —":"انتظار میں L (AIL) —",
"No payments received":"کوئی ادائیگی وصول نہیں ہوئی",
"Fill":"بھریں",
"New beam (":"نیا بیم (",
"Previous beam (":"پچھلا بیم (",
"Woven":"بُنا ہوا",
"Rate (Rs/m)":"ریٹ (روپے/میٹر)",
"Carry Forward (Rs)":"آگے لے جانا (روپے)",
"Current Rate (Rs/m)":"موجودہ ریٹ (روپے/میٹر)",
"New Rate (Rs/m)":"نیا ریٹ (روپے/میٹر)",
"Live figures, always up to date — this is exactly what to tell an employee if they ask how much of their loan is still outstanding.":"براہِ راست اعداد، ہمیشہ تازہ — اگر ملازم پوچھے کہ اس کا کتنا قرض باقی ہے تو یہی بتائیں۔",
"Total Outstanding (All Employees)":"کل باقی (تمام ملازمین)",
"This Month (Given − Repaid)":"اس مہینے (دیا − واپس)",
"Live figures, always up to date — this is exactly what to tell someone if they ask how much of their loan is still outstanding.":"براہِ راست اعداد، ہمیشہ تازہ — اگر کوئی پوچھے کہ اس کا کتنا قرض باقی ہے تو یہی بتائیں۔",
"Total Outstanding (All People)":"کل باقی (تمام افراد)",
"Paid back from recovery (optional)":"وصولی سے واپس ادا (اختیاری)",
"Warp (Tana) Cost / Meter":"تانے کی لاگت / میٹر",
"Weft (Bana) Cost / Meter":"بانے کی لاگت / میٹر",
"Rate (Rs)":"ریٹ (روپے)",
"Amount (Rs)":"رقم (روپے)",
"Client Statement (continued)":"گاہک کا اسٹیٹمنٹ (جاری)",
"Yarn Cost (":"دھاگے کی لاگت (",
"Page":"صفحہ",
"Lot returned":"لاٹ واپس",
"Phone:":"فون:",
"Cloud Sync (their phone needs Encrypt Data on).":"کلاؤڈ سنک (ان کے فون پر ڈیٹا انکرپٹ آن ہونا چاہیے)۔",
"WhatsApp":"واٹس ایپ",
"New code":"نیا کوڈ",
"New code: the old one stops working and they must type the new one.":"نیا کوڈ: پرانا کام کرنا بند کر دے گا اور انہیں نیا لکھنا ہوگا۔",
"Nothing to unlock yet: their role does not include any section (or their approval has ended).":"ابھی کھولنے کو کچھ نہیں: ان کے کردار میں کوئی سیکشن شامل نہیں (یا ان کی منظوری ختم ہو گئی)۔",
"Unlock my sections":"میرے سیکشنز کھولیں",
"Send this code to":"یہ کوڈ بھیجیں",
"Dark Mode":"ڈارک موڈ",
"Show logs as cards on phones":"فون پر لاگ کارڈز کی شکل میں دکھائیں",
"Shown on the header of printed Sale receipts (Sales Log → Receipt). Leave any of these blank to leave that line off the receipt.":"چھپی ہوئی فروخت کی رسیدوں کے اوپر دکھایا جاتا ہے (سیلز لاگ ← رسید)۔ کسی کو خالی چھوڑیں تو وہ لائن رسید پر نہیں آئے گی۔",
"Calculated automatically: Produced - Sold - L shortage. Same figures as Overview Stock Position. Read-only.":"خود بخود حساب: تیار − فروخت − L کمی۔ جائزہ کی اسٹاک پوزیشن جیسے ہی اعداد۔ صرف دیکھنے کے لیے۔",
"Stock (mtr)":"اسٹاک (میٹر)",
"6 digits (recommended)":"6 ہندسے (تجویز کردہ)",
"This phone's storage may be full. Take a backup right now so nothing is lost.":"اس فون کی اسٹوریج بھر سکتی ہے۔ ابھی بیک اپ لیں تاکہ کچھ ضائع نہ ہو۔",
"Protect this backup with a password (optional)":"اس بیک اپ کو پاس ورڈ سے محفوظ کریں (اختیاری)",
"Share Backup (Drive, Gmail, WhatsApp…)":"بیک اپ شیئر کریں (ڈرائیو، جی میل، واٹس ایپ…)",
"Picking a file above loads it into the box below — or just paste a backup directly instead.":"اوپر فائل چننے سے وہ نیچے خانے میں لوڈ ہو جاتی ہے — یا بیک اپ سیدھا پیسٹ کریں۔",
"Backup password (at least 6 characters)":"بیک اپ پاس ورڈ (کم از کم 6 حروف)",
"Add":"شامل کریں",
"Enabled.":"چالو۔",
"Ledger size:":"کھاتے کا سائز:",
"Export CSV (":"CSV برآمد کریں (",
"Remarks (optional)":"ریمارکس (اختیاری)",
"Own m":"اپنے میٹر",
"Diff m":"فرق میٹر",
"* rate changed during this period (rate shown is the one on the To date)":"* اس مدت میں ریٹ بدلا (دکھایا گیا ریٹ آخری تاریخ والا ہے)",
"Production by Quality (mtr)":"کوالٹی کے مطابق پیداوار (میٹر)",
"Still owed to employees (running balance)":"ملازمین کو اب بھی واجب (جاری بیلنس)",
"Full tables (all columns)":"مکمل جدول (تمام کالم)",
"Total (Excl. Diff)":"کل (فرق کے بغیر)",
"Total (No Bonus)":"کل (بونس کے بغیر)",
"Bonus (Rs)":"بونس (روپے)",
"Paid ahead (credit):":"پیشگی ادا (کریڈٹ):",
"Earned, paid, bonus and production are for":"کمائی، ادائیگی، بونس اور پیداوار کے لیے ہیں",
"Cheque No (optional)":"چیک نمبر (اختیاری)",
"Bank (optional)":"بینک (اختیاری)",
"Cheque Owner Name (optional)":"چیک مالک کا نام (اختیاری)",
"Cheque Date (optional)":"چیک کی تاریخ (اختیاری)",
"How much of this payment replaces it (Rs)":"اس ادائیگی کا کتنا حصہ اس کی جگہ ہے (روپے)",
"Qty/Rate/Amount are locked on this entry (linked to an L (AIL) shortage record) — only the other fields were updated.":"اس اندراج میں مقدار/ریٹ/رقم مقفل ہیں (L (AIL) کمی کے ریکارڈ سے جڑے) — صرف باقی خانے اپ ڈیٹ ہوئے۔",
"Enter the Shortage (mtr) — type an L count to compute it, or type the negotiated meter figure directly.":"کمی (میٹر) درج کریں — L کی گنتی لکھ کر حساب کریں، یا طے شدہ میٹر سیدھے لکھیں۔",
"Can edit":"ترمیم کر سکتا ہے",
"You can edit until":"آپ ترمیم کر سکتے ہیں تک",
"Opens the app if the PIN is forgotten: on the lock screen tap \"Forgot PIN?\", then \"Use recovery key instead\".":"پن بھول جائیں تو ایپ کھولتی ہے: لاک اسکرین پر \"پن بھول گئے؟\" ٹیپ کریں، پھر \"اس کے بجائے ریکوری کی استعمال کریں\"۔"};
for(const k in I18N_UR_EXTRA){ if(!Object.prototype.hasOwnProperty.call(I18N_UR, k)) I18N_UR[k] = I18N_UR_EXTRA[k]; }
// Text that starts with one of these (and then carries a number or name) keeps its tail as it is.
const I18N_UR_PREFIX = [ ['Remaining to assign:', 'باقی تقسیم کرنا ہے:'], ['Total stock:', 'کل اسٹاک:'], ['Note to', 'نوٹ برائے'], ['Note:', 'نوٹ:'], ['Current question:', 'موجودہ سوال:'], ["Owner\u2019s note:", 'مالک کا نوٹ:'] ];
I18N_UR_PREFIX.push(['Could not open this receipt —','یہ رسید نہیں کھل سکی —'],['No entries match','کوئی اندراج مماثل نہیں'],['Synced','سنک ہوا'],['Pending Cheques —','زیرِ التوا چیک —'],['Bounced Cheques —','باؤنس چیک —'],['Awaiting L (AIL) —','انتظار میں L (AIL) —']);
/* v3.17.74 — more Urdu: labels the first pass missed, plus text that carries a changing number (matched by pattern). Only fills gaps; existing entries win. */
const I18N_UR_V74 = {"Viewing overall (all time)": "مجموعی منظر (تمام وقت)", "Receivable (Outstanding)": "قابلِ وصول (بقایا)", "Produced (mtr)": "پیداوار (میٹر)", "Sold (mtr)": "فروخت (میٹر)", "In Stock (mtr)": "اسٹاک میں (میٹر)", "All figures shown are all-time totals.": "تمام اعداد و شمار مجموعی (تمام وقت) ہیں۔", "Show Before Last Sale": "آخری فروخت سے پہلے کا دکھائیں", "Sales Amount": "فروخت کی رقم", "Amount Received": "وصول شدہ رقم", "Oldest Unpaid Since": "سب سے پرانا بقایا از", "Days Outstanding": "بقایا دن", "Business Expenses": "کاروباری اخراجات", "Family Expenses": "گھریلو اخراجات", "Personal Expenses": "ذاتی اخراجات", "Warp (Tana) Cost": "تانا کی لاگت", "Weft (Bana) Cost": "بانا کی لاگت", "Cumulative (all time to period end)": "مجموعی (شروع سے مدت کے اختتام تک)", "Selected Period Only": "صرف منتخب مدت", "Multiple Entries": "متعدد اندراجات", "Show Form": "فارم دکھائیں", "All": "سب", "7 days": "7 دن", "This month": "اس مہینے", "This week": "اس ہفتے", "Last week": "پچھلا ہفتہ", "All time": "تمام وقت", "Client-wise Breakdown": "کلائنٹ کے لحاظ سے تفصیل", "Employee-wise Breakdown": "ملازم کے لحاظ سے تفصیل", "Person-wise Breakdown": "فرد کے لحاظ سے تفصیل", "Rate per mtr (Rs)": "فی میٹر ریٹ (روپے)", "Invoice No (optional)": "انوائس نمبر (اختیاری)", "Dyeing (optional)": "رنگائی (اختیاری)", "Description (optional)": "تفصیل (اختیاری)", "Show Linked (L) Records": "منسلک (L) ریکارڈ دکھائیں", "Bank Transfer Amount (Rs)": "بینک ٹرانسفر کی رقم (روپے)", "+ Cheques (optional)": "+ چیک (اختیاری)", "Summary": "خلاصہ", "Paid To": "ادا کیا گیا", "Bill": "بل", "Rates": "ریٹس", "Settle": "حساب بے باق", "Owed to You": "آپ کے واجبات", "Label / Quality (optional)": "لیبل / کوالٹی (اختیاری)", "Thread Count (ends/inch)": "دھاگوں کی تعداد (اینڈز/انچ)", "(Kangi)": "(کنگی)", "Width (inches)": "چوڑائی (انچ)", "(Arz)": "(عرض)", "Width Addition": "چوڑائی میں اضافہ", "Warp (Tana) Count": "تانا کاؤنٹ", "Warp (Tana) Rate per lb (Rs)": "تانا فی پاؤنڈ ریٹ (روپے)", "Weft (Bana) Count": "بانا کاؤنٹ", "Weft (Bana) Rate per lb (Rs)": "بانا فی پاؤنڈ ریٹ (روپے)", "No. of Picks (per inch)": "پکس کی تعداد (فی انچ)", "Rate per Pick (Rs)": "فی پک ریٹ (روپے)", "Extra Addition (Rs)": "اضافی رقم (روپے)", "Yarn Cost (Warp + Weft)": "دھاگے کی لاگت (تانا + بانا)", "usually 2, sometimes 2.5": "عموماً 2، کبھی 2.5", "Warp Count/Type": "تانا کاؤنٹ / قسم", "Supplier": "سپلائر", "Cartons": "کارٹن", "Kg per Carton": "کلو فی کارٹن", "Rate per lb (Rs)": "فی پاؤنڈ ریٹ (روپے)", "Yarn Count/Type": "دھاگے کا کاؤنٹ / قسم", "Number of Bags": "بیگز کی تعداد", "Lbs per Bag": "پاؤنڈ فی بیگ", "Warp Type": "تانے کی قسم", "Beam Length (meters)": "بیم کی لمبائی (میٹر)", "Source Purchase": "ماخذ خریداری", "No active beams.": "کوئی فعال بیم نہیں۔", "No finished beams yet.": "ابھی کوئی مکمل بیم نہیں۔", "Cash Balance (Rs)": "نقد بیلنس (روپے)", "Remarks": "ریمارکس", "Capital now": "موجودہ سرمایہ", "Sales First": "پہلے فروخت", "Profit": "منافع", "Year-on-year starts from your second year.": "سال بہ سال موازنہ دوسرے سال سے شروع ہوگا۔", "All years": "تمام سال", "Export CSV": "CSV ایکسپورٹ", "First": "پہلا", "current": "موجودہ", "Capital": "سرمایہ", "Show": "دکھائیں", "Pick a year or quarter": "سال یا سہ ماہی منتخب کریں", "The first period has no opening position: it runs from the very first entry.": "پہلی مدت کی کوئی ابتدائی پوزیشن نہیں: یہ پہلے اندراج سے شروع ہوتی ہے۔", "Warp (tana) bought": "تانا خریدا", "Weft (bana) bought": "بانا خریدا", "Family expenses": "گھریلو اخراجات", "Personal expenses": "ذاتی اخراجات", "Total drawings": "کل نکلوائی گئی رقم", "Cash and bank": "نقد اور بینک", "Receivables": "قابلِ وصول رقوم", "Employee loans": "ملازمین کے قرض", "Yarn in hand": "موجود دھاگا", "Grey cloth in hand": "موجود کورا کپڑا", "Bills due": "واجب الادا بل", "Total position": "کل پوزیشن", "This period has not ended: figures are up to today.": "یہ مدت ابھی ختم نہیں ہوئی: اعداد و شمار آج تک کے ہیں۔", "Yarn in hand (Rs)": "موجود دھاگا (روپے)", "Bills due (Rs)": "واجب الادا بل (روپے)", "Cash and bank (Rs)": "نقد اور بینک (روپے)", "Yarn in hand, warp + weft (Rs)": "موجود دھاگا، تانا + بانا (روپے)", "Receivables per client (Rs)": "فی کلائنٹ قابلِ وصول (روپے)", "Employee loans per employee (Rs)": "فی ملازم قرض (روپے)", "No grey cloth in stock on this date.": "اس تاریخ پر کورے کپڑے کا اسٹاک نہیں۔", "Year-end carry-over": "سال کے آخر میں آگے منتقلی", "Rate per meter": "فی میٹر ریٹ", "Last 6 months": "پچھلے 6 مہینے", "Last 12 months": "پچھلے 12 مہینے", "Last 24 months": "پچھلے 24 مہینے", "All available": "تمام دستیاب", "Produced": "پیداوار", "Sold": "فروخت", "Expenses": "اخراجات", "Banks": "بینک", "Business Name": "کاروبار کا نام", "Address": "پتہ", "Phone": "فون", "Add Bank": "بینک شامل کریں", "Encryption": "انکرپشن", "Cloud People": "کلاؤڈ صارفین", "New PIN": "نیا پن", "Confirm PIN": "پن کی تصدیق", "Question": "سوال", "Answer": "جواب", "Confirm answer": "جواب کی تصدیق", "Add this device in 5 steps": "اس ڈیوائس کو 5 مراحل میں شامل کریں", "Turn on Cloud Sync": "کلاؤڈ سنک آن کریں", "Sign in with your email": "اپنے ای میل سے سائن اِن کریں", "Clients": "کلائنٹس", "Family Members": "گھر کے افراد", "Add Client": "کلائنٹ شامل کریں", "Deactivate": "غیر فعال کریں", "Add Employee": "ملازم شامل کریں", "Add Family Member": "فرد شامل کریں", "Total Stock": "کل اسٹاک", "By Quality": "کوالٹی کے لحاظ سے", "Warp Types": "تانے کی اقسام", "Weft Types": "بانے کی اقسام", "Dyeing Units": "رنگائی یونٹس", "Add Loom": "لوم شامل کریں", "Add Quality": "کوالٹی شامل کریں", "Add Warp Type": "تانے کی قسم شامل کریں", "Add Weft Type": "بانے کی قسم شامل کریں", "Add Dyeing Unit": "رنگائی یونٹ شامل کریں", "3 days or less left (recommended)": "3 دن یا کم باقی (تجویز کردہ)", "No backup taken yet on this device.": "اس ڈیوائس پر ابھی تک بیک اپ نہیں لیا گیا۔", "Automatic email backup is off.": "خودکار ای میل بیک اپ بند ہے۔", "Saved": "محفوظ", "Contents": "مشمولات", "Automatic": "خودکار", "e.g. Meezan Bank": "مثلاً میزان بینک", "e.g. Ali Textiles": "مثلاً علی ٹیکسٹائل", "e.g. Nasir Ahmed": "مثلاً ناصر احمد", "e.g. Uncle Rafiq": "مثلاً چچا رفیق", "e.g. 44 Picks": "مثلاً 44 پکس", "e.g. Al-Karam Dyeing": "مثلاً الکرم ڈائنگ", "Paste the backup key": "بیک اپ کی پیسٹ کریں", "Optional, at least 6 characters": "اختیاری، کم از کم 6 حروف", "You haven't taken a backup on this device yet. If it's lost, reset, or the app data is cleared, everything goes with it.": "آپ نے اس ڈیوائس پر ابھی تک بیک اپ نہیں لیا۔ اگر یہ گم ہو جائے، ری سیٹ ہو جائے یا ایپ کا ڈیٹا صاف ہو جائے تو سب کچھ ختم ہو جائے گا۔", "Time helps tell entries apart when several looms are logged the same day — it doesn't need to be exact.": "وقت سے ایک ہی دن کے کئی لوم کے اندراجات الگ پہچانے جاتے ہیں — اس کا عین درست ہونا ضروری نہیں۔", "More details — invoice no, dyeing": "مزید تفصیل — انوائس نمبر، رنگائی", "Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.": "وقت سے ایک ہی دن کے اندراجات کو کیش چیک پوائنٹس کے مطابق ترتیب دیا جاتا ہے — اس کا عین درست ہونا ضروری نہیں۔", "Turn off to go back to the classic sideways-scrolling tables. Only affects small screens.": "پرانے سائیڈ میں سکرول ہونے والے ٹیبل پر واپس جانے کے لیے بند کریں۔ صرف چھوٹی اسکرین پر اثر کرتا ہے۔", "Year-on-year": "سال بہ سال"};
Object.assign(I18N_UR_V74, {"Opening position 2027": "ابتدائی پوزیشن 2027", "Opening capital 2027": "ابتدائی سرمایہ 2027", "Grey cloth in hand (meters and rate per meter)": "موجود کورا کپڑا (میٹر اور فی میٹر ریٹ)", "Closing capital (opening + profit after drawings)": "اختتامی سرمایہ (ابتدائی + نکلوانے کے بعد منافع)", "Beam Summary by Purchase — In Progress": "خریداری کے لحاظ سے بیم خلاصہ — جاری", "Beam Summary by Purchase — Completed": "خریداری کے لحاظ سے بیم خلاصہ — مکمل", "Open the link we email you to verify": "تصدیق کے لیے ای میل میں بھیجا گیا لنک کھولیں", "Type the access code from the owner (below)": "مالک کا دیا گیا رسائی کوڈ (نیچے) درج کریں", "Personal loans given (Rs 0) are kept apart and not counted. Fixed assets are never included.": "دیے گئے ذاتی قرض الگ رکھے جاتے ہیں اور شمار نہیں ہوتے۔ فکسڈ اثاثے کبھی شامل نہیں کیے جاتے۔", "e.g. 150.144 Micro": "مثلاً 150.144 مائیکرو", "e.g. 20/1 Carded": "مثلاً 20/1 کارڈڈ"});
for(const k in I18N_UR_V74){ if(!Object.prototype.hasOwnProperty.call(I18N_UR, k)) I18N_UR[k] = I18N_UR_V74[k]; }
const I18N_UR_RE74 = [[new RegExp("^[\\u2014\\u2013-]? ?\\u26a0? ?No backup yet \\u2014 ([\\d,]+) entries live only on this phone\\.$"),"ابھی تک بیک اپ نہیں — $1 اندراجات صرف اسی فون میں ہیں۔"],[new RegExp("^Week (.+) m$"),"ہفتہ $1 م"],[new RegExp("^Page (\\d+) of (\\d+) \\((\\d+) records\\)$"),"صفحہ $1 از $2 ($3 ریکارڈ)"],[new RegExp("^Export CSV \\((\\d+)\\)$"),"CSV ایکسپورٹ ($1)"],[new RegExp("^([\\u25b2\\u25bc]) (\\d+)% this month vs last month$"),"$1 $2% اس مہینے بمقابلہ پچھلا مہینہ"],[new RegExp("^(\\d+)[\\u2013\\u2014-](\\d+) Days$"),"$1–$2 دن"],[new RegExp("^Cash Rs (.+)$"),"نقد Rs $1"],[new RegExp("^Rs (.+) credit$"),"Rs $1 جمع (کریڈٹ)"],[new RegExp("^Paid ahead \\(credit\\): (.+)$"),"پیشگی ادا (کریڈٹ): $1"],[new RegExp("^Rs (.+) \\(incl\\. Rs (.+) wages\\)$"),"Rs $1 (بشمول Rs $2 اجرت)"],[new RegExp("^Rs (.+) \\((\\d+) sets\\)$"),"Rs $1 ($2 سیٹ)"],[new RegExp("^Rs (.+) \\((\\d+) bags\\)$"),"Rs $1 ($2 بیگ)"],[new RegExp("^Opening capital: (.+)$"),"ابتدائی سرمایہ: $1"],[new RegExp("^Position at (.+)$"),"پوزیشن بتاریخ $1"],[new RegExp("^Earned, paid, bonus and production are for (.+) to (.+)$"),"کمائی، ادائیگی، بونس اور پیداوار $1 سے $2 تک کی ہیں"],[new RegExp("^Total: Rs (.+)$"),"کل: Rs $1"],[new RegExp("^Ledger size: (.+)$"),"لیجر کا سائز: $1"]];
const I18N_MON74 = {"Jan": "جنوری", "Feb": "فروری", "Mar": "مارچ", "Apr": "اپریل", "May": "مئی", "Jun": "جون", "Jul": "جولائی", "Aug": "اگست", "Sep": "ستمبر", "Oct": "اکتوبر", "Nov": "نومبر", "Dec": "دسمبر"};
I18N_UR_RE74.push([/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d\d)$/, '$1 $2']);
/* v3.18.27 — Orders page in Urdu: the page was added after the dictionary, so its labels, buttons, cards, forms, messages and pop-ups were missing. Only fills gaps; existing entries win. */
const I18N_UR_ORD = {
  'New order':'نیا آرڈر', 'Agreement':'معاہدہ', 'Order no.':'آرڈر نمبر', 'Date of agreement':'معاہدے کی تاریخ', 'Parties':'فریقین', 'Seller':'فروخت کنندہ', 'Buyer (client)':'خریدار (کلائنٹ)',
  'Cloth and price':'کپڑا اور قیمت', 'Width (inches)':'چوڑائی (انچ)', 'Ordered meters':'آرڈر کردہ میٹر', 'Agreed rate (Rs/m)':'طے شدہ ریٹ (روپے/میٹر)', 'Delivery terms':'ڈیلیوری کی شرائط',
  'Tolerance % (default 5)':'کمی بیشی کی گنجائش % (عام طور پر 5)', 'Minimum batch m (optional)':'کم از کم قسط میٹر (اختیاری)', 'Per week m (optional)':'فی ہفتہ میٹر (اختیاری)',
  'In the presence of':'موجودگی میں', "From the buyer's side: name":'خریدار کی طرف سے: نام', "From the seller's side: name":'فروخت کنندہ کی طرف سے: نام',
  'Save order':'آرڈر محفوظ کریں', 'Save changes':'تبدیلیاں محفوظ کریں', 'Open orders':'کھلے آرڈرز', 'No open orders.':'کوئی کھلا آرڈر نہیں۔',
  'In progress':'جاری', 'No delivery yet':'ابھی ڈیلیوری نہیں ہوئی', 'Within tolerance':'گنجائش کے اندر', 'Completed':'مکمل', 'Revoked':'منسوخ', 'Delivered':'ڈیلیور شدہ',
  'Avg rate':'اوسط ریٹ', 'Value':'مالیت', 'Batches':'اقساط', 'Last':'آخری', 'Share image':'تصویر شیئر کریں', 'Mark complete':'مکمل قرار دیں', 'Reopen':'دوبارہ کھولیں',
  'Share completion':'تکمیل شیئر کریں', 'Completion PDF':'تکمیل کی PDF', 'Undo revoke':'منسوخی واپس لیں', 'Make replacement':'متبادل آرڈر بنائیں', 'Link existing':'موجودہ آرڈر سے جوڑیں',
  'Revoke':'منسوخ کریں', 'Revoke order':'آرڈر منسوخ کریں', 'Link':'جوڑیں', 'Completion':'تکمیل', 'Completion date':'تکمیل کی تاریخ', 'Date of revocation':'منسوخی کی تاریخ',
  'Terms agreed by both parties':'دونوں فریقوں کی طے کردہ شرائط', 'Make a new order now (opens a form with these details)':'ابھی نیا آرڈر بنائیں (ان تفصیلات کے ساتھ فارم کھلے گا)',
  'Client and quality are locked because deliveries are linked to this order.':'اس آرڈر سے ڈیلیوریاں جڑی ہیں، اس لیے کلائنٹ اور کوالٹی مقفل ہیں۔',
  'Edit order':'آرڈر میں ترمیم', 'Order (optional)':'آرڈر (اختیاری)', 'No order':'کوئی آرڈر نہیں',
  // messages (toasts) and pop-up questions
  'Select the client and the quality first.':'پہلے کلائنٹ اور کوالٹی منتخب کریں۔', 'Enter the ordered meters and the agreed rate first.':'پہلے آرڈر کردہ میٹر اور طے شدہ ریٹ درج کریں۔',
  'A revoked order cannot be edited. Undo the revoke first.':'منسوخ شدہ آرڈر میں ترمیم نہیں ہو سکتی۔ پہلے منسوخی واپس لیں۔', 'That order cannot be linked.':'اس آرڈر کو جوڑا نہیں جا سکتا۔',
  'Pick the replacement order first.':'پہلے متبادل آرڈر منتخب کریں۔', 'No open order of this client to link. Use Make replacement.':'اس کلائنٹ کا کوئی کھلا آرڈر جوڑنے کے لیے نہیں ہے۔ \u201Cمتبادل آرڈر بنائیں\u201D استعمال کریں۔',
  'This order has deliveries linked to it. Mark it complete instead.':'اس آرڈر سے ڈیلیوریاں جڑی ہیں۔ اس کے بجائے اسے مکمل قرار دیں۔', 'Preparing the statement…':'گوشوارہ تیار ہو رہا ہے…',
  'Ready — tap Share once more to send it.':'تیار ہے — بھیجنے کے لیے ایک بار پھر شیئر دبائیں۔', 'Could not make the image. Tap again.':'تصویر نہیں بن سکی۔ دوبارہ دبائیں۔',
  'No terms written. Revoke anyway?':'کوئی شرائط نہیں لکھیں۔ پھر بھی منسوخ کریں؟'
};
for(const k in I18N_UR_ORD){ if(!Object.prototype.hasOwnProperty.call(I18N_UR, k)) I18N_UR[k] = I18N_UR_ORD[k]; }
// Orders text that carries a name, number or date. A pattern may give its Urdu as a text with $1, $2... or as a function of the match.
const I18N_UR_RE_ORD = [
  [/^Edit order (.+)$/, 'آرڈر $1 میں ترمیم'], [/^Revoke (ORD-.+)$/, 'آرڈر $1 منسوخ کریں'], [/^Link (.+) to an existing order$/, '$1 کو موجودہ آرڈر سے جوڑیں'],
  [/^New order \(replaces (.+)\)$/, 'نیا آرڈر ($1 کی جگہ)'], [/^Completed and revoked \((\d+)\)$/, 'مکمل اور منسوخ ($1)'],
  [/^(.+) m already delivered stays on this order at Rs (.+)\/m\.$/, '$1 میٹر جو پہلے ڈیلیور ہو چکے وہ اسی آرڈر پر Rs $2/میٹر کے حساب سے رہیں گے۔'],
  [/^Open orders of (.+) that are not already a replacement\.$/, '$1 کے وہ کھلے آرڈرز جو پہلے سے کسی کا متبادل نہیں۔'],
  [/^(ORD-.+) · (.+) · Rs (.+)\/m$/, '$1 · $2 · Rs $3/میٹر'], [/^of (.+) m$/, 'از $1 میٹر'], [/^(.+) m to go$/, '$1 میٹر باقی'], [/^\+(.+) m extra$/, '+$1 میٹر زائد'],
  [/^Over by (.+) m \((.+)\)$/, '$1 میٹر زائد ($2)'], [/^This week (.+) of (.+) m( \(done\))?$/, m => 'اس ہفتے ' + m[1] + ' از ' + m[2] + ' میٹر' + (m[3] ? ' (مکمل)' : '')],
  [/^Minimum batch (.+) m$/, 'کم از کم قسط $1 میٹر'], [/^(\d+) batch\(es\) at a different rate than Rs (.+)$/, '$1 قسط(یں) طے شدہ Rs $2 سے مختلف ریٹ پر'],
  [/^Stock covers (.+) m$/, 'اسٹاک سے $1 میٹر پورے ہوتے ہیں'], [/^(.+) m still to weave$/, '$1 میٹر ابھی بُننا باقی ہے'], [/^Replaces (.+)$/, '$1 کی جگہ'],
  [/^Revoked (.+?)(, replaced by (.+))?$/, m => 'منسوخ ' + m[1] + (m[3] ? '، متبادل ' + m[3] : '')], [/^Changed (.+?): (.+)$/, 'تبدیلی $1: $2'],
  [/^(ORD-[^:]+): (.+) m at Rs (.+)$/, '$1: $2 میٹر Rs $3 پر'],
  [/^Order value Rs (.+)\. Tolerance range (.+) to (.+) m\.$/, 'آرڈر کی مالیت Rs $1۔ گنجائش کی حد $2 سے $3 میٹر۔'],
  [/^(.+) m at Rs (.+), delivered (.+) m(, (.+) m to go)?( \((revoked|completed)\))?$/, m => m[1] + ' میٹر Rs ' + m[2] + ' پر، ڈیلیور ' + m[3] + ' میٹر' + (m[5] ? '، ' + m[5] + ' میٹر باقی' : '') + (m[7] ? (m[7] === 'revoked' ? ' (منسوخ)' : ' (مکمل)') : '')],
  [/^(ORD-.+) already has deliveries, so this revoke cannot be undone\.$/, '$1 پر ڈیلیوریاں ہو چکی ہیں، اس لیے یہ منسوخی واپس نہیں ہو سکتی۔'],
  [/^Undo the revocation of (.*?)\?( The replacement (.+) \(no deliveries\) will be deleted\.)?$/, m => 'آرڈر ' + m[1] + ' کی منسوخی واپس لیں؟' + (m[3] ? ' متبادل آرڈر ' + m[3] + ' (جس پر ڈیلیوری نہیں) حذف ہو جائے گا۔' : '')],
  [/^Delete order (.+)\?$/, 'آرڈر $1 حذف کریں؟'], [/^This order already has deliveries\. Change (.+)\?$/, 'اس آرڈر پر ڈیلیوریاں ہو چکی ہیں۔ $1 تبدیل کریں؟']
];
I18N_UR_RE_ORD.forEach(p => I18N_UR_RE74.push(p));
const I18N_ATTRS = ['placeholder', 'title', 'aria-label'];
let I18N_LANG = 'en';
let I18N_TIMER = 0;
let I18N_OBS = null;
const I18N_NODES = (typeof WeakMap !== 'undefined') ? new WeakMap() : null; // text node -> {en, ur}

// The Urdu for one piece of text (already trimmed), or null when it is not in the dictionary.
function i18nTranslate(s){
  if(Object.prototype.hasOwnProperty.call(I18N_UR, s)) return I18N_UR[s];
  for(const [p, u] of I18N_UR_PREFIX){ if(s.startsWith(p)) return u + s.slice(p.length); }
  for(const [re, out] of I18N_UR_RE74){ const m = re.exec(s); if(m){ if(typeof out === 'function') return out(m); return out.replace(/\$(\d)/g, (_, i)=> m[+i] === undefined ? '' : (I18N_MON74[m[+i]] || m[+i])); } }
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
if(typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.__i18nConfirm){ const _c = window.confirm.bind(window); window.confirm = m => _c(I18N_LANG === 'ur' ? (i18nTranslate(String(m).replace(/\s+/g, ' ').trim()) || m) : m); window.__i18nConfirm = 1; }
if(typeof document !== 'undefined' && document.body){ i18nInit(); }
