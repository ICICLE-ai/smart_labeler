#!/bin/bash
# fix-permissions.sh
echo "Fixing file permissions..."

find . -type d -not -path "./.git/*" -exec chmod 755 {} \;
find . -type f -not -path "./.git/*" -exec chmod 644 {} \;
find . -name "*.sh" -exec chmod 755 {} \;

echo "Done!"