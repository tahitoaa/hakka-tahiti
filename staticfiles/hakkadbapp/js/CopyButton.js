/** A small icon button pinned to the corner of its target's card, so it
 *  reads as part of that output rather than a separate block between
 *  outputs. The target's parent must be `position: relative` (or static,
 *  in which case the button just floats top-right of the page flow). */
class CopyButton {
    /**
     * targetSelector: CSS selector of the element the button is pinned to.
     * options.getText: optional () => string overriding what gets copied —
     * use it when the wanted copy text differs from the target's own
     * rendered content (e.g. a card that displays one format but should
     * copy another). Defaults to reading the target's own rendered text.
     */
    constructor(targetSelector, options = {}) {
        this.target = document.querySelector(targetSelector);
        if (!this.target) return;

        // Button config
        this.icon = options.icon || "📋";
        this.successIcon = options.successIcon || "✅";
        this.label = options.label || "Copy";
        this.timeout = options.timeout || 1200;
        this.getText = options.getText || (() => this.target.innerText ?? this.target.textContent);

        // Create the button
        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.textContent = this.icon;
        this.button.title = this.label;
        this.button.setAttribute("aria-label", this.label);
        this.button.className = options.className || "absolute top-2 right-2 min-h-9 min-w-9 flex items-center justify-center rounded-md border bg-white/90 hover:bg-brand/10 active:bg-brand/20 text-brand text-base leading-none shadow-sm touch-manipulation";

        // Append inside the target's card, as a sibling of the target so
        // its own text never gets swept up by copy()'s textContent read.
        (this.target.parentElement || this.target).appendChild(this.button);

        this.button.addEventListener("click", () => this.copy());
    }

    async copy() {
        try {
            await navigator.clipboard.writeText(this.getText().trim());

            // Feedback
            this.button.textContent = this.successIcon;

            setTimeout(() => {
                this.button.textContent = this.icon;
            }, this.timeout);

        } catch (err) {
            console.error("Copy failed:", err);
        }
    }
}
