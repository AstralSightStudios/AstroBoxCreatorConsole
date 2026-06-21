package moe.astralsight.astroboxcc

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Tauri 2.11+ no longer wires the plugin lifecycle automatically here;
    // without this call the Android plugins are never initialized ("die").
    getPluginManager().onActivityCreate(this)
  }
}
