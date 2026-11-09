// Reserve the actual visible rail widths, including catalog panels with fluid widths.
let initialized = false;
export function initializeDetailModalLayout() {
    if (initialized) return;
    initialized = true;
    const overlay = document.getElementById('detail-modal-overlay');
    if (!overlay) return;
    const leftPanel = document.getElementById('wtf-plans-panel');
    const forum = document.getElementById('forum-panel');
    const chat = document.getElementById('unified-chat-panel');
    function update() {
        const wide = window.innerWidth >= 1100;
        const left = wide && leftPanel?.classList.contains('open') ? leftPanel.getBoundingClientRect().width : 0;
        const right = wide ? Math.max(
            forum?.classList.contains('open') ? forum.getBoundingClientRect().width : 0,
            document.body.classList.contains('ucp-panel-open') && !chat?.classList.contains('ucp-fullscreen')
                ? chat?.getBoundingClientRect().width || 0 : 0
        ) : 0;
        document.documentElement.style.setProperty('--detail-left-inset', `${left}px`);
        document.documentElement.style.setProperty('--detail-right-inset', `${right}px`);
    }
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const resizeObserver = new ResizeObserver(update);
    [leftPanel, forum, chat].filter(Boolean).forEach(panel => {
        observer.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
        resizeObserver.observe(panel);
    });
    window.addEventListener('resize', update);
    update();
}
