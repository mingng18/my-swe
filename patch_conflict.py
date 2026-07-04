import re

def resolve_file(filepath, theirs=True):
    with open(filepath, "r") as f:
        content = f.read()

    # We will prefer theirs (origin/main) because someone else probably merged a similar fix or refactored it
    # We will split by conflict markers and keep the origin/main side.

    parts = re.split(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> origin/main\n?', content, flags=re.DOTALL)

    if len(parts) > 1:
        resolved = parts[0]
        for i in range(1, len(parts), 3):
            head_content = parts[i]
            main_content = parts[i+1]
            tail = parts[i+2]

            resolved += main_content + '\n' + tail

        with open(filepath, "w") as f:
            f.write(resolved)

resolve_file("swe-ui/components/ThreadMonitor.tsx")
resolve_file("swe-ui/components/thread-monitor/ThreadEmptyState.tsx")
