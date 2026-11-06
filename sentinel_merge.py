import re

with open(".jules/sentinel.md", "r") as f:
    content = f.read()

# Simple regex to replace the conflict markers with just the content
content = re.sub(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>>.*?\n', r'\1\n\2\n', content, flags=re.DOTALL)

with open(".jules/sentinel.md", "w") as f:
    f.write(content)
