sed -i '/<<<<<<< HEAD/d' .Jules/palette.md
sed -i '/=======/d' .Jules/palette.md
sed -i '/>>>>>>> origin\/main/d' .Jules/palette.md

sed -i '/<<<<<<< HEAD/d' swe-ui/components/ai-elements/snippet.tsx
sed -i '/=======/d' swe-ui/components/ai-elements/snippet.tsx
sed -i '/aria-label="Copy"/d' swe-ui/components/ai-elements/snippet.tsx
sed -i '/>>>>>>> origin\/main/d' swe-ui/components/ai-elements/snippet.tsx
sed -i '/<TooltipContent>Copy<\/TooltipContent>/d' swe-ui/components/ai-elements/snippet.tsx
