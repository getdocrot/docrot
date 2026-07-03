# Animated demo for the README, recorded with vhs
# https://github.com/charmbracelet/vhs
#
# From the repo root, with a fresh axios clone next to it:
#   git clone --depth 1 https://github.com/axios/axios ../axios-demo
#   vhs docs/demo.tape

Output docs/assets/demo.gif

Set FontSize 15
Set Width 1000
Set Height 620
Set Padding 16
Set Theme "GitHub Dark"

Type "npx docrot ../axios-demo"
Sleep 500ms
Enter
Sleep 8s
