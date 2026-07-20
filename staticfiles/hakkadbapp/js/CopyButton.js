class CopyButton {
    /**
     * targetSelector: CSS selector of the element whose content will be copied.
     * options: optional size/label parameters.
     */
    constructor(targetSelector, options = {}) {
        this.target = document.querySelector(targetSelector);
        if (!this.target) return;

        // Button config
        this.label = options.label || "Copy";
        this.successLabel = options.successLabel || "Copied!";
        this.timeout = options.timeout || 1200;

        // Create the button
        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.textContent = this.label;
        this.button.className = options.className || "mb-1 min-h-9 px-3 py-1 text-xs font-medium rounded-md border bg-white hover:bg-brand/10 active:bg-brand/20 text-brand touch-manipulation";

        // Insert before target element
        this.target.insertAdjacentElement("beforebegin", this.button);

        this.button.addEventListener("click", () => this.copy());
    }

    /** Copy the textContent of the target element */
    async copy() {
        try {
            await navigator.clipboard.writeText(this.target.textContent.trim());

            // Feedback
            const old = this.button.textContent;
            this.button.textContent = this.successLabel;

            setTimeout(() => {
                this.button.textContent = this.label;
            }, this.timeout);

        } catch (err) {
            console.error("Copy failed:", err);
        }
    }
}
