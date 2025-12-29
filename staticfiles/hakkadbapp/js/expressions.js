document.addEventListener("DOMContentLoaded", 
    () => {
        const container = document.getElementById("expressions");
        if (!container) return [];

        const dico = new Dictionary({
            itemSelector: 'li',
            containerId: '#pron-list',
        })
        const expressions =  Array.from(container.children).map(div => {
            return new Sentence(dico, div.dataset.text, div.dataset.french)
        });

        const output = document.getElementById("output");
        expressions.forEach((e, index) => {
            output.innerHTML += '<li>' +`<span>phrase ${index}</span>` + e.render() + '</li>';
        })
        container.append(output);
    }
)