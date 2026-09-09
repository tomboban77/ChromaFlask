/** Keep scrollable forms inside the area visible above a software keyboard. */
export function installFormViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const style = document.documentElement.style;
  let frame = 0;
  const update = (): void => {
    frame = 0;
    // Pinch zoom should magnify the existing layout, not reflow it.
    if (Math.abs(viewport.scale - 1) > 0.01) return;
    style.setProperty('--form-viewport-height', `${viewport.height}px`);
    style.setProperty('--form-viewport-top', `${viewport.offsetTop}px`);
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('pageshow', schedule);
  update();
}
