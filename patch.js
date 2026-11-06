const fs = require('fs');
let content = fs.readFileSync('.jules/bolt.md', 'utf8');
content = content.replace(/<<<<<<< HEAD\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> origin\/main/g, '$1\n$2');
fs.writeFileSync('.jules/bolt.md', content);
