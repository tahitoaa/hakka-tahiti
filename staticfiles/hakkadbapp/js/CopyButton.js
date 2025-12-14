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
        this.button.textContent = this.label;
        this.button.style.marginLeft = "6px";
        this.button.style.cursor = "pointer";

        // Insert after target element
        this.target.insertAdjacentElement("before", this.button);

        // Attach event
        document.addEventListener('DOMContentLoaded', ()=>{
            this.button.addEventListener("click", () => this.copy());
            console.log(button);
            console.log(target);
        })
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
