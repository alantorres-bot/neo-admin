$Host.UI.RawUI.WindowTitle = "GRAVAR TOKEN DO SLACK - Neo Admin"
Set-Location "C:\dev\neo-admin"
Write-Host ""
Write-Host "Cole o Bot User OAuth Token (xoxb-...) do aplicativo Neo Admin e tecle Enter." -ForegroundColor Yellow
Write-Host "O valor nao aparece na tela e vai direto para os segredos do Supabase (SLACK_BOT_TOKEN)." -ForegroundColor Yellow
Write-Host ""
node scripts/gravar-segredo.mjs SLACK_BOT_TOKEN --ref chdszjpbtfpstjrqnmmm
Write-Host ""
Write-Host "Pronto. Pode fechar esta janela." -ForegroundColor Green
Read-Host "Tecle Enter para fechar"
