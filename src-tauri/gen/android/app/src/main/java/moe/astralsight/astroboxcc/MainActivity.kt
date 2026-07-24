package moe.astralsight.astroboxcc

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

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
}
