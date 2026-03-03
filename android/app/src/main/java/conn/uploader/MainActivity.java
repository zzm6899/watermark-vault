package conn.uploader;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import app.lovable.camerausb.CameraUsbPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CameraUsbPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
