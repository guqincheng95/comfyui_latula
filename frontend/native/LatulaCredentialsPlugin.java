package com.latula.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LatulaCredentials")
public class LatulaCredentialsPlugin extends Plugin {
    private static final String ALIAS = "latula.runninghub.v1";
    private SharedPreferences prefs() { return getContext().getSharedPreferences("latula-credentials", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    @PluginMethod public void set(PluginCall call) {
        try {
            String value = call.getString("value", "");
            if (value.isEmpty()) { call.reject("密钥不能为空"); return; }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!prefs().edit().putString("value", encrypted).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new Exception();
            call.resolve();
        } catch (Exception ignored) { call.reject("无法安全保存密钥，请重试"); }
    }
    @PluginMethod public void get(PluginCall call) {
        try {
            String encrypted = prefs().getString("value", ""), value = "";
            if (!encrypted.isEmpty()) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(prefs().getString("iv", ""), Base64.NO_WRAP)));
                value = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            JSObject result = new JSObject(); result.put("value", value); call.resolve(result);
        } catch (Exception ignored) { call.reject("已保存的密钥无法解密，请清除后重新填写"); }
    }
    @PluginMethod public void clear(PluginCall call) {
        if (prefs().edit().clear().commit()) call.resolve(); else call.reject("清除密钥失败");
    }
}
