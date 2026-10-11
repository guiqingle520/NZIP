using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;
namespace NZIP {
    public sealed partial class DesktopWindow {
        [DllImport("dwmapi.dll")]static extern int DwmSetWindowAttribute(IntPtr handle,int attribute,ref int value,int size);
        bool DarkTheme {get{if(preferences.Str("theme")=="dark")return true;if(preferences.Str("theme")!="system")return false;using(var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))return key!=null&&Convert.ToInt32(key.GetValue("AppsUseLightTheme",1))==0;}}
        internal void StyleDialog(Form form){bool dark=DarkTheme;StyleControl(form,dark);try{int value=dark?1:0;DwmSetWindowAttribute(form.Handle,20,ref value,4);}catch(DllNotFoundException){}foreach(var strip in new ToolStrip[]{menus,status}){strip.Renderer=new ToolStripProfessionalRenderer(new NativeColors(dark));strip.ForeColor=dark?Color.Gainsboro:Color.Black;}}
        static void StyleControl(Control control,bool dark){if(Convert.ToString(control.Tag)=="accent")return;control.BackColor=dark?Color.FromArgb(34,34,36):Color.White;control.ForeColor=dark?Color.Gainsboro:Color.Black;var button=control as Button;if(button!=null){button.FlatStyle=dark?FlatStyle.Flat:FlatStyle.Standard;if(dark)button.FlatAppearance.BorderColor=Color.FromArgb(80,80,82);}foreach(Control child in control.Controls)StyleControl(child,dark);var strip=control as ToolStrip;if(strip!=null)foreach(ToolStripItem item in strip.Items)StyleItem(item,dark);}
        static void StyleItem(ToolStripItem item,bool dark){item.ForeColor=dark?Color.Gainsboro:Color.Black;item.BackColor=dark?Color.FromArgb(34,34,36):Color.White;var menu=item as ToolStripDropDownItem;if(menu!=null){menu.DropDown.BackColor=item.BackColor;menu.DropDown.ForeColor=item.ForeColor;foreach(ToolStripItem child in menu.DropDownItems)StyleItem(child,dark);}}
        sealed class NativeColors:ProfessionalColorTable {readonly bool dark;public NativeColors(bool value){dark=value;UseSystemColors=!value;}public override Color ToolStripDropDownBackground{get{return dark?Color.FromArgb(34,34,36):base.ToolStripDropDownBackground;}}public override Color ImageMarginGradientBegin{get{return ToolStripDropDownBackground;}}public override Color ImageMarginGradientMiddle{get{return ToolStripDropDownBackground;}}public override Color ImageMarginGradientEnd{get{return ToolStripDropDownBackground;}}public override Color MenuItemSelected{get{return dark?Color.FromArgb(55,85,120):base.MenuItemSelected;}}public override Color MenuItemBorder{get{return dark?Color.FromArgb(65,95,130):base.MenuItemBorder;}}}
    }
}
