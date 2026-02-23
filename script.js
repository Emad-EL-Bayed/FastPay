<script>
    function copyCard(btn) {
        const card = btn.closest('.card');
        
        // جلب البيانات بشكل منظم
        const header = card.querySelector('.card-header').innerText;
        const details = Array.from(card.querySelectorAll('.item')).map(el => el.innerText).join('\n');
        const instructions = card.querySelector('.instr').innerText;
        
        // تنسيق النص النهائي للنسخ
        const textToCopy = `📍 ${header}\n${details}\n\n📝 تعليمات:\n${instructions}\n\n--- تم النسخ من Fast Pay ---`;

        // محاولة النسخ باستخدام API الحديثة
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                showToast();
            }).catch(err => {
                // إذا فشلت الطريقة الحديثة نستخدم الطريقة التقليدية
                fallbackCopyTextToClipboard(textToCopy);
            });
        } else {
            fallbackCopyTextToClipboard(textToCopy);
        }
    }

    // طريقة بديلة للنسخ تضمن العمل على كل المتصفحات
    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";  // تجنب التمرير للأسفل
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showToast();
        } catch (err) {
            console.error('فشل النسخ', err);
        }
        document.body.removeChild(textArea);
    }

    function showToast() {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }

    // كود الفلترة (يبقى كما هو)
    const searchInput = document.getElementById('search');
    const countryFilter = document.getElementById('countryFilter');

    function filterData() {
        const query = searchInput.value.toLowerCase();
        const category = countryFilter.value;
        const cards = document.querySelectorAll('.card');

        cards.forEach(card => {
            const text = card.innerText.toLowerCase();
            const country = card.getAttribute('data-country');
            const matchesSearch = text.includes(query);
            const matchesFilter = category === 'all' || country === category;
            card.style.display = (matchesSearch && matchesFilter) ? 'flex' : 'none';
        });
    }

    searchInput.addEventListener('input', filterData);
    countryFilter.addEventListener('change', filterData);
</script>