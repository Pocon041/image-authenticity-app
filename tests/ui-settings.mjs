export async function selectAnalysisMode(page, name) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '开发与单模型调试', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
