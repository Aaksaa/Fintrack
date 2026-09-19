/**
 * Fintrack - Backend Google Apps Script
 * Deskripsi: Mengelola database multi-sheet bulanan untuk pencatatan keuangan.
 */

const INDO_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

const MONTH_CODES = [
  "JAN", "FEB", "MAR", "APR", "MEI", "JUN", 
  "JUL", "AGU", "SEP", "OKT", "NOV", "DES"
];

/**
 * Endpoint utama Web App untuk melayani frontend HTML.
 */
function doGet() {
  try {
    return HtmlService.createTemplateFromFile('Index')
        .evaluate()
        .setTitle('Fintrack - Catat pengeluaran dengan mudah dan teratur')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (e) {
    return HtmlService.createHtmlOutput("<h1>Terjadi Kesalahan Sistem</h1><p>" + e.toString() + "</p>");
  }
}

/**
 * Mendapatkan spreadsheet aktif secara dinamis atau berdasarkan ID yang fleksibel.
 */
function getSpreadsheet() {
  try {
    var properties = PropertiesService.getScriptProperties();
    var id = properties.getProperty('SPREADSHEET_ID');
    if (id && id.trim() !== "") {
      return SpreadsheetApp.openById(id.trim());
    }
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    throw new Error("Gagal membuka spreadsheet. Hubungkan script dengan spreadsheet atau tambahkan SPREADSHEET_ID di Properties Script. Detail: " + e.message);
  }
}

/**
 * Merapikan formula SUM di bagian paling bawah sheet bulanan.
 */
function refreshTotalRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  
  // Jika baris terakhir adalah header, buat baris total di baris 2
  if (lastRow === 1) {
    sheet.appendRow(["", "", "", "Total Bulanan", 0, ""]);
    lastRow = 2;
  }
  
  var labelCell = sheet.getRange(lastRow, 4);
  var totalCell = sheet.getRange(lastRow, 5);
  
  labelCell.setValue("Total Bulanan");
  
  if (lastRow === 2) {
    // Tidak ada transaksi, total = 0
    totalCell.setValue(0);
  } else {
    // Set formula sum dari E2 sampai baris sebelum total
    totalCell.setFormula("=SUM(E2:E" + (lastRow - 1) + ")");
  }
  
  // Gaya visual total row
  var totalRowRange = sheet.getRange(lastRow, 1, 1, 6);
  totalRowRange.setFontWeight("bold");
  totalRowRange.setBackground("#f7f8fa");
  totalCell.setNumberFormat("[$Rp-421]#,##0");
}

/**
 * Menghasilkan atau mendapatkan sheet bulanan.
 */
function getOrCreateMonthlySheet(tanggal) {
  var ss = getSpreadsheet();
  var date = new Date(tanggal);
  var monthIndex = date.getMonth();
  var year = date.getFullYear();
  var sheetName = INDO_MONTHS[monthIndex] + " " + year;
  
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    
    // Header
    var headers = ["No", "Tanggal", "Kategori", "Keterangan", "Jumlah Uang Keluar", "ID Unik Global"];
    sheet.appendRow(headers);
    
    // Styling header
    var headerRange = sheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1c1c1e"); // Miro dark charcoal
    headerRange.setFontColor("#ffffff");
    headerRange.setHorizontalAlignment("center");
    sheet.setRowHeight(1, 30);
    
    // Baris awal untuk Total Bulanan
    sheet.appendRow(["", "", "", "Total Bulanan", 0, ""]);
    
    // Formatting kolom
    sheet.getRange("B:B").setHorizontalAlignment("center");
    sheet.getRange("C:C").setHorizontalAlignment("center");
    sheet.getRange("E:E").setNumberFormat("[$Rp-421]#,##0");
    sheet.getRange("F:F").setHorizontalAlignment("center");
    
    refreshTotalRow(sheet);
    sheet.autoResizeColumns(1, 6);
    
    // Buat/update rekap awal di MASTER_REKAP
    updateMasterRekap(sheetName);
  }
  return sheet;
}

/**
 * Mengecek dan membuat sheet baru jika berganti bulan.
 */
function checkAndCreateNewMonth() {
  try {
    var now = new Date();
    getOrCreateMonthlySheet(now);
    return { success: true, message: "Pemeriksaan bulan baru berhasil." };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Menghitung nomor urut (No) per sheet dan ID unik global.
 */
function getNextSerialNumber(sheet, monthCode, yearCode, monthNum) {
  var lastRow = sheet.getLastRow();
  
  // Jika hanya ada header dan total bulanan (kosong)
  if (lastRow <= 2) {
    return {
      no: monthCode + "-001",
      id: "TRX-" + yearCode + "-" + monthNum + "-001"
    };
  }
  
  // Baca baris transaksi terakhir (baris sebelum total bulanan)
  var lastTxRow = lastRow - 1;
  var lastNo = sheet.getRange(lastTxRow, 1).getValue().toString();
  var lastId = sheet.getRange(lastTxRow, 6).getValue().toString();
  
  var nextNoNum = 1;
  var matchNo = lastNo.match(/-(\d+)$/);
  if (matchNo) {
    nextNoNum = parseInt(matchNo[1], 10) + 1;
  }
  
  var nextIdNum = 1;
  var matchId = lastId.match(/-(\d+)$/);
  if (matchId) {
    nextIdNum = parseInt(matchId[1], 10) + 1;
  }
  
  var pad = function(num, size) {
    var s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
  };
  
  return {
    no: monthCode + "-" + pad(nextNoNum, 3),
    id: "TRX-" + yearCode + "-" + monthNum + "-" + pad(nextIdNum, 3)
  };
}

/**
 * Formatting object Date ke string DD/MM/YYYY.
 */
function formatDateString(val) {
  if (val instanceof Date) {
    var d = val.getDate();
    var m = val.getMonth() + 1;
    var y = val.getFullYear();
    return (d < 10 ? "0" + d : d) + "/" + (m < 10 ? "0" + m : m) + "/" + y;
  }
  return val.toString();
}

/**
 * Parsing string DD/MM/YYYY kembali ke Date.
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  var parts = dateStr.split("/");
  if (parts.length === 3) {
    return new Date(parts[2], parts[1] - 1, parts[0]);
  }
  return new Date(dateStr);
}

/**
 * Mengambil semua transaksi dari seluruh sheet bulanan.
 */
function getAllData() {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var allData = [];
    
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var name = sheet.getName();
      if (name === "MASTER_REKAP" || name === "TRASH") continue;
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 2) continue; // kosong
      
      var values = sheet.getRange(2, 1, lastRow - 2, 6).getValues();
      for (var r = 0; r < values.length; r++) {
        var row = values[r];
        allData.push({
          no: row[0],
          tanggal: formatDateString(row[1]),
          kategori: row[2],
          keterangan: row[3],
          jumlah: parseFloat(row[4]) || 0,
          id: row[5],
          bulan: name
        });
      }
    }
    
    // Urutkan tanggal terbaru di atas
    allData.sort(function(a, b) {
      return parseDate(b.tanggal) - parseDate(a.tanggal);
    });
    
    return { success: true, data: allData };
  } catch (e) {
    return { success: false, message: "Gagal memuat semua data: " + e.message, data: [] };
  }
}

/**
 * Mengambil data transaksi per bulan tertentu.
 */
function getDataByMonth(bulanTahun) {
  try {
    if (!bulanTahun || bulanTahun === "Semua Bulan") {
      return getAllData();
    }
    
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(bulanTahun);
    if (!sheet) {
      return { success: true, data: [] };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 2) return { success: true, data: [] };
    
    var values = sheet.getRange(2, 1, lastRow - 2, 6).getValues();
    var data = [];
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      data.push({
        no: row[0],
        tanggal: formatDateString(row[1]),
        kategori: row[2],
        keterangan: row[3],
        jumlah: parseFloat(row[4]) || 0,
        id: row[5],
        bulan: bulanTahun
      });
    }
    
    data.sort(function(a, b) {
      return parseDate(b.tanggal) - parseDate(a.tanggal);
    });
    
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: "Gagal memuat data bulanan: " + e.message, data: [] };
  }
}

/**
 * Menambahkan data pengeluaran baru.
 */
function tambahData(data) {
  try {
    if (!data.tanggal || !data.keterangan || !data.jumlah) {
      throw new Error("Kolom tanggal, keterangan, dan jumlah wajib diisi.");
    }
    var jumlah = parseFloat(data.jumlah);
    if (isNaN(jumlah) || jumlah < 1000) {
      throw new Error("Jumlah Uang Keluar harus berupa angka minimal Rp 1.000.");
    }
    
    var dateParts = data.tanggal.split("-"); // YYYY-MM-DD
    if (dateParts.length !== 3) {
      throw new Error("Format tanggal salah.");
    }
    
    var year = dateParts[0];
    var monthNum = dateParts[1];
    var day = dateParts[2];
    var formattedDate = day + "/" + monthNum + "/" + year;
    
    var monthIndex = parseInt(monthNum, 10) - 1;
    var monthCode = MONTH_CODES[monthIndex];
    
    var sheet = getOrCreateMonthlySheet(new Date(data.tanggal));
    var sheetName = sheet.getName();
    
    var serials = getNextSerialNumber(sheet, monthCode, year, monthNum);
    var no = serials.no;
    var id = serials.id;
    
    var lastRow = sheet.getLastRow();
    
    // Sisipkan baris sebelum baris total bulanan
    sheet.insertRowBefore(lastRow);
    sheet.getRange(lastRow, 1, 1, 6).setValues([[
      no, 
      formattedDate, 
      data.kategori || "Lainnya", 
      data.keterangan, 
      jumlah, 
      id
    ]]);
    
    refreshTotalRow(sheet);
    updateMasterRekap(sheetName);
    
    return { success: true, message: "Transaksi " + id + " berhasil ditambahkan.", data: { id: id } };
  } catch (e) {
    return { success: false, message: "Gagal menyimpan data: " + e.message };
  }
}

/**
 * Memperbarui data transaksi berdasarkan ID.
 */
function updateData(id, data) {
  try {
    if (!data.tanggal || !data.keterangan || !data.jumlah) {
      throw new Error("Kolom tanggal, keterangan, dan jumlah wajib diisi.");
    }
    var jumlah = parseFloat(data.jumlah);
    if (isNaN(jumlah) || jumlah < 1000) {
      throw new Error("Jumlah Uang Keluar harus berupa angka minimal Rp 1.000.");
    }
    
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var found = false;
    var updatedResult = null;
    
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var name = sheet.getName();
      if (name === "MASTER_REKAP" || name === "TRASH") continue;
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 2) continue;
      
      var ids = sheet.getRange(2, 6, lastRow - 2, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (ids[r][0] === id) {
          var rowNum = r + 2;
          var rowData = sheet.getRange(rowNum, 1, 1, 6).getValues()[0];
          
          var oldDateStr = rowData[1]; // DD/MM/YYYY
          var oldParts = oldDateStr.split("/");
          var oldMonthName = INDO_MONTHS[parseInt(oldParts[1], 10) - 1] + " " + oldParts[2];
          
          var newParts = data.tanggal.split("-"); // YYYY-MM-DD
          var newMonthIndex = parseInt(newParts[1], 10) - 1;
          var newMonthName = INDO_MONTHS[newMonthIndex] + " " + newParts[0];
          
          if (oldMonthName !== newMonthName) {
            // Hapus dari sheet bulan lama
            sheet.deleteRow(rowNum);
            refreshTotalRow(sheet);
            updateMasterRekap(oldMonthName);
            
            // Tambahkan ke sheet bulan baru (mendapatkan No dan ID baru sesuai bulan baru)
            var addRes = tambahData(data);
            if (!addRes.success) {
              throw new Error("Gagal memindahkan data ke sheet baru: " + addRes.message);
            }
            updatedResult = addRes.data;
          } else {
            // Bulan sama, update langsung barisnya
            var formattedDate = newParts[2] + "/" + newParts[1] + "/" + newParts[0];
            sheet.getRange(rowNum, 2).setValue(formattedDate);
            sheet.getRange(rowNum, 3).setValue(data.kategori || "Lainnya");
            sheet.getRange(rowNum, 4).setValue(data.keterangan);
            sheet.getRange(rowNum, 5).setValue(jumlah);
            
            refreshTotalRow(sheet);
            updateMasterRekap(name);
            updatedResult = { id: id };
          }
          found = true;
          break;
        }
      }
      if (found) break;
    }
    
    if (found) {
      return { success: true, message: "Transaksi berhasil diperbarui.", data: updatedResult };
    }
    return { success: false, message: "Transaksi tidak ditemukan." };
  } catch (e) {
    return { success: false, message: "Gagal memperbarui data: " + e.message };
  }
}

/**
 * Menghapus transaksi dan memindahkannya ke sheet TRASH (soft delete).
 */
function hapusData(id) {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var found = false;
    var originalSheetName = "";
    
    // Inisialisasi sheet TRASH jika belum ada
    var trashSheet = ss.getSheetByName("TRASH");
    if (!trashSheet) {
      trashSheet = ss.insertSheet("TRASH");
      trashSheet.appendRow(["ID Unik Global", "Bulan Asal", "No", "Tanggal", "Kategori", "Keterangan", "Jumlah Uang Keluar", "Deleted At"]);
      var headerRange = trashSheet.getRange(1, 1, 1, 8);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#ff9999"); // Miro light coral
      headerRange.setFontColor("#1c1c1e");
      trashSheet.setRowHeight(1, 30);
      trashSheet.getRange("G:G").setNumberFormat("[$Rp-421]#,##0");
      trashSheet.autoResizeColumns(1, 8);
    }
    
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var name = sheet.getName();
      if (name === "MASTER_REKAP" || name === "TRASH") continue;
      
      var lastRow = sheet.getLastRow();
      if (lastRow <= 2) continue;
      
      var ids = sheet.getRange(2, 6, lastRow - 2, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (ids[r][0] === id) {
          var rowNum = r + 2;
          var rowData = sheet.getRange(rowNum, 1, 1, 6).getValues()[0];
          
          var no = rowData[0];
          var tanggal = rowData[1];
          var kategori = rowData[2];
          var keterangan = rowData[3];
          var jumlah = rowData[4];
          
          var deletedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
          
          // Pindahkan ke TRASH
          trashSheet.appendRow([id, name, no, tanggal, kategori, keterangan, jumlah, deletedAt]);
          trashSheet.autoResizeColumns(1, 8);
          
          // Hapus baris di sheet asal
          sheet.deleteRow(rowNum);
          originalSheetName = name;
          
          refreshTotalRow(sheet);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    
    if (found) {
      refreshTotalRow(sheet);
      updateMasterRekap(originalSheetName);
      return { success: true, message: "Transaksi berhasil dipindahkan ke Keranjang Sampah." };
    }
    return { success: false, message: "Transaksi tidak ditemukan." };
  } catch (e) {
    return { success: false, message: "Gagal menghapus data: " + e.message };
  }
}

/**
 * Memulihkan transaksi dari TRASH kembali ke sheet asalnya.
 */
function restoreData(id) {
  try {
    var ss = getSpreadsheet();
    var trashSheet = ss.getSheetByName("TRASH");
    if (!trashSheet) {
      return { success: false, message: "Keranjang Sampah kosong." };
    }
    
    var lastRow = trashSheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "Keranjang Sampah kosong." };
    
    var ids = trashSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var foundRow = -1;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        foundRow = i + 2;
        break;
      }
    }
    
    if (foundRow === -1) {
      return { success: false, message: "Transaksi tidak ditemukan di Keranjang Sampah." };
    }
    
    var rowData = trashSheet.getRange(foundRow, 1, 1, 8).getValues()[0];
    var bulanAsal = rowData[1];
    var no = rowData[2];
    var tanggal = rowData[3];
    var kategori = rowData[4];
    var keterangan = rowData[5];
    var jumlah = rowData[6];
    
    // Cari atau buat kembali sheet bulanan asalnya jika terhapus
    var targetSheet = ss.getSheetByName(bulanAsal);
    if (!targetSheet) {
      var dateObj = parseDate(tanggal);
      targetSheet = getOrCreateMonthlySheet(dateObj);
      bulanAsal = targetSheet.getName();
    }
    
    var targetLastRow = targetSheet.getLastRow();
    
    // Masukkan kembali sebelum total row
    targetSheet.insertRowBefore(targetLastRow);
    targetSheet.getRange(targetLastRow, 1, 1, 6).setValues([[
      no, tanggal, kategori, keterangan, jumlah, id
    ]]);
    
    // Hapus dari TRASH
    trashSheet.deleteRow(foundRow);
    
    refreshTotalRow(targetSheet);
    updateMasterRekap(bulanAsal);
    
    return { success: true, message: "Transaksi berhasil dipulihkan ke " + bulanAsal + "." };
  } catch (e) {
    return { success: false, message: "Gagal memulihkan data: " + e.message };
  }
}

/**
 * Menghapus data secara permanen dari sheet TRASH (hard delete).
 * Data ini akan dihapus total dari perhitungan dan tidak bisa dipulihkan.
 */
function hapusDataPermanen(id) {
  try {
    var ss = getSpreadsheet();
    var trashSheet = ss.getSheetByName("TRASH");
    if (!trashSheet) {
      return { success: false, message: "Keranjang Sampah kosong." };
    }
    
    var lastRow = trashSheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, message: "Keranjang Sampah kosong." };
    }
    
    var ids = trashSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var foundRow = -1;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        foundRow = i + 2;
        break;
      }
    }
    
    if (foundRow === -1) {
      return { success: false, message: "Data tidak ditemukan di Keranjang Sampah." };
    }
    
    var rowData = trashSheet.getRange(foundRow, 1, 1, 8).getValues()[0];
    var bulanAsal = rowData[1]; // untuk update master rekap
    
    // Hapus permanently dari TRASH
    trashSheet.deleteRow(foundRow);
    
    // Update total row di sheet asal jika sheet masih ada
    var targetSheet = ss.getSheetByName(bulanAsal);
    if (targetSheet) {
      refreshTotalRow(targetSheet);
      updateMasterRekap(bulanAsal);
    }
    
    return { success: true, message: "Transaksi berhasil dihapus permanen." };
  } catch (e) {
    return { success: false, message: "Gagal menghapus permanen: " + e.message };
  }
}
  function getTrashData() {
  try {
    var ss = getSpreadsheet();
    var trashSheet = ss.getSheetByName("TRASH");
    if (!trashSheet) return { success: true, data: [] };
    
    var lastRow = trashSheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };
    
    var values = trashSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var data = [];
    for (var i = 0; i < values.length; i++) {
      data.push({
        id: values[i][0],
        bulanAsal: values[i][1],
        no: values[i][2],
        tanggal: formatDateString(values[i][3]),
        kategori: values[i][4],
        keterangan: values[i][5],
        jumlah: parseFloat(values[i][6]) || 0,
        deletedAt: values[i][7]
      });
    }
    data.reverse(); // data terbaru dihapus berada di paling atas
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: e.message, data: [] };
  }
}

/**
 * Konversi nilai kolom Bulan (bisa berupa string atau Date) menjadi format standar "Bulan Tahun" (e.g., "Agustus 2026").
 */
function getMonthYearString(val) {
  if (val instanceof Date) {
    var monthIndex = val.getMonth();
    var year = val.getFullYear();
    return INDO_MONTHS[monthIndex] + " " + year;
  }
  if (!val) return "";
  
  var strVal = String(val).trim();
  var dateParsed = new Date(strVal);
  if (strVal.includes("-") && !isNaN(dateParsed.getTime())) {
    var monthIndex = dateParsed.getMonth();
    var year = dateParsed.getFullYear();
    return INDO_MONTHS[monthIndex] + " " + year;
  }
  return strVal;
}

/**
 * Mengubah string "Bulan Tahun" atau objek Date menjadi objek Date yang representatif untuk pengurutan.
 */
function parseMonthYear(str) {
  if (str instanceof Date) {
    return str;
  }
  if (!str) {
    return new Date(0);
  }
  var strVal = String(str).trim();
  var parts = strVal.split(" ");
  if (parts.length < 2) {
    var parsedDate = new Date(strVal);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
    return new Date(0);
  }
  var monthIndex = INDO_MONTHS.indexOf(parts[0]);
  if (monthIndex === -1) {
    var parsedDate = new Date(strVal);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
    return new Date(0);
  }
  var year = parseInt(parts[1], 10);
  if (isNaN(year)) {
    return new Date(0);
  }
  return new Date(year, monthIndex, 1);
}

/**
 * Mendapatkan daftar bulan yang tersedia berdasarkan nama sheet.
 */
function getAvailableMonths() {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var months = [];
    
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName();
      if (name === "MASTER_REKAP" || name === "TRASH") continue;
      months.push(name);
    }
    
    // Urutkan dari bulan terbaru ke terlama
    months.sort(function(a, b) {
      return parseMonthYear(b) - parseMonthYear(a);
    });
    
    return { success: true, data: months };
  } catch (e) {
    return { success: false, message: "Gagal memuat daftar bulan: " + e.message, data: [] };
  }
}

/**
 * Memperbarui MASTER_REKAP untuk bulan tertentu.
 */
function updateMasterRekap(bulanTahun) {
  var ss = getSpreadsheet();
  var masterSheet = ss.getSheetByName("MASTER_REKAP");
  if (!masterSheet) {
    masterSheet = ss.insertSheet("MASTER_REKAP");
    masterSheet.appendRow(["Bulan", "Budget", "Total Pengeluaran Bulanan", "Jumlah Transaksi", "Rata-rata per Transaksi", "Link ke Sheet"]);
    var headerRange = masterSheet.getRange(1, 1, 1, 6);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#ffd02f"); // Miro Canary Yellow
    headerRange.setFontColor("#1c1c1e");
    headerRange.setHorizontalAlignment("center");
    masterSheet.setRowHeight(1, 30);
    masterSheet.getRange("B:B").setNumberFormat("[$Rp-421]#,##0");
    masterSheet.getRange("C:C").setNumberFormat("[$Rp-421]#,##0");
    masterSheet.getRange("D:D").setHorizontalAlignment("center");
    masterSheet.getRange("E:E").setNumberFormat("[$Rp-421]#,##0");
    masterSheet.autoResizeColumns(1, 6);
  }
  
  var targetSheet = ss.getSheetByName(bulanTahun);
  if (!targetSheet) return;
  
  var lastRow = targetSheet.getLastRow();
  var total = 0;
  var count = 0;
  
  if (lastRow > 2) {
    var values = targetSheet.getRange(2, 5, lastRow - 2, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var val = parseFloat(values[i][0]);
      if (!isNaN(val)) {
        total += val;
        count++;
      }
    }
  }
  
  var avg = count > 0 ? total / count : 0;
  var link = ss.getUrl() + "#gid=" + targetSheet.getSheetId();
  
  var masterLastRow = masterSheet.getLastRow();
  var foundRow = -1;
  if (masterLastRow > 1) {
    var months = masterSheet.getRange(2, 1, masterLastRow - 1, 1).getValues();
    for (var j = 0; j < months.length; j++) {
      if (getMonthYearString(months[j][0]) === getMonthYearString(bulanTahun)) {
        foundRow = j + 2;
        break;
      }
    }
  }
  
  if (foundRow !== -1) {
    masterSheet.getRange(foundRow, 3).setValue(total);
    masterSheet.getRange(foundRow, 4).setValue(count);
    masterSheet.getRange(foundRow, 5).setValue(avg);
    masterSheet.getRange(foundRow, 6).setValue(link);
  } else {
    // Default budget = 0
    masterSheet.appendRow([bulanTahun, 0, total, count, avg, link]);
  }
  
  masterSheet.autoResizeColumns(1, 6);
}

/**
 * Menyimpan budget bulanan baru.
 */
function updateMonthlyBudget(bulanTahun, budget) {
  try {
    var ss = getSpreadsheet();
    var masterSheet = ss.getSheetByName("MASTER_REKAP");
    if (!masterSheet) {
      updateMasterRekap(bulanTahun);
      masterSheet = ss.getSheetByName("MASTER_REKAP");
    }
    
    var lastRow = masterSheet.getLastRow();
    var foundRow = -1;
    if (lastRow > 1) {
      var months = masterSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < months.length; i++) {
        if (getMonthYearString(months[i][0]) === getMonthYearString(bulanTahun)) {
          foundRow = i + 2;
          break;
        }
      }
    }
    
    if (foundRow !== -1) {
      masterSheet.getRange(foundRow, 2).setValue(budget);
    } else {
      masterSheet.appendRow([bulanTahun, budget, 0, 0, 0, ""]);
    }
    
    return { success: true, message: "Budget untuk " + bulanTahun + " berhasil di-update." };
  } catch (e) {
    return { success: false, message: "Gagal menyimpan budget: " + e.message };
  }
}

/**
 * Mengambil ringkasan bulanan dari MASTER_REKAP.
 */
function getMonthlySummary() {
  try {
    var ss = getSpreadsheet();
    var masterSheet = ss.getSheetByName("MASTER_REKAP");
    if (!masterSheet) return { success: true, data: [] };
    
    var lastRow = masterSheet.getLastRow();
    if (lastRow < 2) return { success: true, data: [] };
    
    var values = masterSheet.getRange(2, 1, lastRow - 1, 6).getValues();
    var data = [];
    for (var i = 0; i < values.length; i++) {
      data.push({
        bulan: getMonthYearString(values[i][0]),
        budget: parseFloat(values[i][1]) || 0,
        total: parseFloat(values[i][2]) || 0,
        jumlahTransaksi: parseInt(values[i][3], 10) || 0,
        rataRata: parseFloat(values[i][4]) || 0,
        link: values[i][5]
      });
    }
    
    // Urutkan secara kronologis terbalik
    data.sort(function(a, b) {
      return parseMonthYear(b.bulan) - parseMonthYear(a.bulan);
    });
    
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: "Gagal memuat rekap master: " + e.message, data: [] };
  }
}

/**
 * Memasukkan data awal contoh untuk demo (Januari & Februari 2026).
 */
function seedInitialData() {
  try {
    var ss = getSpreadsheet();
    
    var janSheet = getOrCreateMonthlySheet(new Date("2026-01-15"));
    var febSheet = getOrCreateMonthlySheet(new Date("2026-02-15"));
    
    var seeded = false;
    
    if (janSheet.getLastRow() <= 2) {
      var janTx = [
        { tanggal: "2026-01-05", kategori: "Makanan", keterangan: "Makan Siang Bersama Tim", jumlah: 85000 },
        { tanggal: "2026-01-12", kategori: "Transportasi", keterangan: "Isi Bensin Mobil", jumlah: 150000 },
        { tanggal: "2026-01-20", kategori: "Belanja", keterangan: "Belanja Bulanan Supermarket", jumlah: 640000 },
        { tanggal: "2026-01-28", kategori: "Hiburan", keterangan: "Tiket Nonton Bioskop", jumlah: 70000 }
      ];
      for (var i = 0; i < janTx.length; i++) {
        tambahData(janTx[i]);
      }
      updateMonthlyBudget("Januari 2026", 2000000);
      seeded = true;
    }
    
    if (febSheet.getLastRow() <= 2) {
      var febTx = [
        { tanggal: "2026-02-02", kategori: "Utilitas", keterangan: "Token Listrik & Air", jumlah: 450000 },
        { tanggal: "2026-02-08", kategori: "Makanan", keterangan: "Kopi Latte & Roti Bakar", jumlah: 55000 },
        { tanggal: "2026-02-15", kategori: "Transportasi", keterangan: "Ganti Oli Motor", jumlah: 120000 },
        { tanggal: "2026-02-22", kategori: "Belanja", keterangan: "Beli Sepatu Baru", jumlah: 350000 }
      ];
      for (var j = 0; j < febTx.length; j++) {
        tambahData(febTx[j]);
      }
      updateMonthlyBudget("Februari 2026", 2500000);
      seeded = true;
    }
    
    if (seeded) {
      return { success: true, message: "Data contoh Januari & Februari 2026 berhasil dimasukkan ke Spreadsheet." };
    } else {
      return { success: true, message: "Spreadsheet sudah memiliki data. Tidak ada data contoh baru yang dimasukkan." };
    }
  } catch (e) {
    return { success: false, message: "Gagal seeding data: " + e.message };
  }
}
