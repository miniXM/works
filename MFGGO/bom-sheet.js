import { createUniver, LocaleType, LifecycleStages, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import coreZh from '@univerjs/preset-sheets-core/locales/zh-CN';
import { UniverSheetsDrawingPreset, DRAWING_IMAGE_ALLOW_IMAGE_LIST } from '@univerjs/preset-sheets-drawing';
import drawingZh from '@univerjs/preset-sheets-drawing/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-drawing/lib/index.css';
import './bom-sheet.css';

DRAWING_IMAGE_ALLOW_IMAGE_LIST.splice(0, DRAWING_IMAGE_ALLOW_IMAGE_LIST.length, 'image/png', 'image/jpeg', 'image/webp');

window.createBomWorkbook = async ({ snapshot, editable = true, onChange = () => {}, onSave = () => {}, images = [] }) => {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: mergeLocales(coreZh, drawingZh) },
    presets: [UniverSheetsCorePreset({ container: 'sheet', header: true, toolbar: true, ribbonType: 'classic', formulaBar: true }), UniverSheetsDrawingPreset({ allowImageSize: 1 })],
  });
  const workbook = univerAPI.createWorkbook(snapshot);
  if (univerAPI.getCurrentLifecycleStage() < LifecycleStages.Rendered) {
    await new Promise(resolve => {
      const listener = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
        if (stage >= LifecycleStages.Rendered) { listener.dispose(); resolve(); }
      });
    });
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const entry of images) {
    const sheet = workbook.getSheetBySheetId(entry.sheetId) || workbook.getActiveSheet();
    const image = await sheet.newOverGridImage().setSource(entry.dataUrl, univerAPI.Enum.ImageSourceType.BASE64)
      .setColumn(entry.column).setRow(entry.row).setWidth(entry.width).setHeight(entry.height).buildAsync();
    sheet.insertImages([image]);
  }
  workbook.setEditable(editable);
  const changes = univerAPI.onCommandExecuted(command => {
    if (/^(?:sheet|drawing)\.mutation\./.test(command.id)
      && !/formula|permission|protection/i.test(command.id)) onChange();
  });
  const keyboard = event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (editable) onSave();
    }
  };
  window.addEventListener('keydown', keyboard, true);
  return {
    api: univerAPI,
    async snapshot() {
      await workbook.endEditingAsync(true);
      return workbook.save();
    },
    isEditing() { return workbook.isCellEditing(); },
    setEditable(value) { editable = Boolean(value); workbook.setEditable(editable); },
    dispose() { window.removeEventListener('keydown', keyboard, true); changes.dispose(); univer.dispose(); },
  };
};
window.dispatchEvent(new Event('bom-sheet-ready'));
