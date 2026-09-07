package moe.astralsight.astroboxcc

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    // Tauri 2.11+ no longer wires the plugin lifecycle automatically here;
    // without this call the Android plugins are never initialized ("die").
    getPluginManager().onActivityCreate(this)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.isStatusBarContrastEnforced = false
    window.isNavigationBarContrastEnforced = false
  }

  @Keep
  fun shareFileFromNative(path: String, fileName: String, mimeType: String): Boolean {
    return try {
      val file = File(path)
      if (!file.isFile) {
        Log.e("AstroBoxCCShare", "share source file does not exist: $path")
        return false
      }

      val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
      val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType.ifBlank { "application/octet-stream" }
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, fileName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      startActivity(Intent.createChooser(sendIntent, fileName))
      true
    } catch (error: Throwable) {
      Log.e("AstroBoxCCShare", "failed to launch native share sheet", error)
      false
    }
  }
}
